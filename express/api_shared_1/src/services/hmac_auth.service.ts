import { createClient } from "redis";
import { CreateHmacClientOptions, initializeHmacHttpAuth, PropagateHmacClientOptions, SignedHttpFetchClientCallOptions } from "@naskot/node-hmac-auth";

const redis = createClient({
  url: process.env.REDIS_URL, // ex: redis://user:password@127.0.0.1:6379
});

await redis.connect();

export const hmacAuth = initializeHmacHttpAuth({
  redis,
  namespace: process.env.HMAC_NAMESPACE ?? "my-api-prod",
  maxSkewMs: 5 * 60 * 1000,
  defaultSecretLengthBytes: 32,
  secretToken: process.env.HMAC_SECRET_TOKEN, // strongly recommended
  internalManagementRoute: process.env.INTERNAL_MANAGEMENT_ROUTE ?? "/api/internal/hmac-auth", // optional: clientId propagation between APIs
  onBadSignature: async (event) => {
    const meta = (event.metadata ?? {}) as {
      ip?: string;
      remoteAddress?: string;
      forwardedFor?: string | string[];
    };

    const forwarded = Array.isArray(meta.forwardedFor) ? meta.forwardedFor[0] : meta.forwardedFor;
    const ipFromForwarded = forwarded?.split(",")[0]?.trim();
    const ip = ipFromForwarded || meta.ip || meta.remoteAddress || "unknown";

    console.warn("BAD_SIGNATURE", {
      ip,
      clientId: event.clientId,
      path: event.path,
      nonce: event.nonce,
      timestamp: event.timestamp,
    });
  },
});

const internalHttp = {
  /**
   * Build a signed fetch function from a clientId by resolving its secretHash from Redis.
   *
   * Usage:
   * const signer = await internalHttp.createSignedFetchFromClientId("svc-a");
   * await signer("https://api.example.com/secure", { method: "POST" });
   */
  createSignedFetchFromClientId: async (clientId: string) => {
    const client = await hmacAuth.clients.get(clientId);
    if (!client) {
      throw new Error(`${clientId} not found in Redis`);
    }

    return hmacAuth.createHttpSignedFetchClient({
      clientId,
      secret: client.secretHash,
      secretIsHashed: true,
    });
  },

  /**
   * Execute one signed HTTP request by clientId.
   *
   * Usage:
   * await internalHttp.signedFetchWithClientId("https://api.example.com/secure", "svc-a", { method: "POST" });
   */
  signedFetchWithClientId: async (input: string, clientId: string, options?: SignedHttpFetchClientCallOptions) => {
    const signedFetch = await internalHttp.createSignedFetchFromClientId(clientId);
    return signedFetch(input, options);
  },
};

export const credential = {
  /**
   * Read one client credential by clientId.
   *
   * Usage:
   * const client = await credential.get("client_mobile");
   */
  get: async (clientId: string) => {
    return await hmacAuth.clients.get(clientId);
  },

  /**
   * Create a client credential only if it does not already exist.
   *
   * Usage:
   * await credential.create({
   *   clientId: "client_mobile",
   *   plainSecret: "superSharedSecret",
   *   expiresAt: null,
   * });
   */
  create: async (opts: CreateHmacClientOptions) => {
    if (await credential.get(opts.clientId)) {
      return { status: false as const, error: `Cannot create credential: clientId '${opts.clientId}' already exists.` };
    }

    return await hmacAuth.clients.create(opts);
  },

  /**
   * Regenerate an existing client secret using a required plainSecret.
   *
   * Usage:
   * await credential.regenerateSecret("client_mobile", "newSuperSecret");
   */
  regenerateSecret: async (clientId: string, plainSecret: string) => {
    if (!(await credential.get(clientId))) {
      return { status: false as const, error: `Cannot regenerate credential: clientId '${clientId}' does not exist.` };
    }

    return await hmacAuth.clients.regenerateSecret(clientId, { plainSecret });
  },

  /**
   * Revoke (delete) an existing client credential.
   *
   * Usage:
   * await credential.revoke("client_mobile");
   */
  revoke: async (clientId: string) => {
    if (!(await credential.get(clientId))) {
      return { status: false as const, error: `Cannot revoke credential: clientId '${clientId}' does not exist.` };
    }

    await hmacAuth.clients.delete(clientId);
    return { status: true as const, clientId };
  },
};

export const http = {
  /**
   * Set one or more candidate clientIds for a signed fetch context.
   * The first non-empty clientId is always used.
   *
   * Usage:
   * await http.use("svc-a").fetch("https://api.example.com/secure", { method: "POST" });
   * await http.useClientIds("svc-a").fetch("https://api.example.com/secure", { method: "POST" });
   */
  use: (...clientIds: string[]) => http.useClientIds(...clientIds),
  useClientIds: (...clientIds: string[]) => {
    const firstClientId = clientIds.find((value) => typeof value === "string" && value.trim());
    if (!firstClientId) {
      throw new Error("Missing required clientId. Usage: http.useClientIds('svc-a').fetch(url, options)");
    }

    return {
      fetch: (input: string, options?: SignedHttpFetchClientCallOptions) => {
        return internalHttp.signedFetchWithClientId(input, firstClientId, options);
      },
    };
  },

  /**
   * Express middleware helper for protected routes.
   *
   * Usage:
   * app.use("/secure", http.middleware);
   */
  middleware: hmacAuth.verifyHttpRequest,
};

type PropagateServiceCreateOptions = { propagateClientId: string; useClientId?: string; targetApis: string[]; plainSecret: string };
type PropagateServiceUpdateOptions = { propagateClientId: string; useClientId?: string; targetApis: string[]; plainSecret: string };
type PropagateServiceDeleteOptions = { propagateClientId: string; useClientId?: string; targetApis: string[] };
type PropagateServiceHealthOptions = { useClientId: string; targetApis: string[] };

export const interApi = {
  /**
   * Internal management middleware for inter-API clientId propagation route.
   *
   * Usage:
   * app.use(interApi.middleware);
   */
  middleware: hmacAuth.createInternalManagementMiddleware(),

  propagate: {
    create: async (opts: PropagateServiceCreateOptions) => {
      const fetchWithClientId = opts.useClientId ? opts.useClientId : opts.propagateClientId;

      const results = await hmacAuth.propagateClientToApis({
        operation: "create",
        targets: opts.targetApis,
        clientId: opts.propagateClientId,
        secret: opts.plainSecret,
        apiFetch: await internalHttp.createSignedFetchFromClientId(fetchWithClientId),
      });

      return results;
    },

    update: async (opts: PropagateServiceUpdateOptions) => {
      const fetchWithClientId = opts.useClientId ? opts.useClientId : opts.propagateClientId;

      const results = await hmacAuth.propagateClientToApis({
        operation: "update",
        targets: opts.targetApis,
        clientId: opts.propagateClientId,
        secret: opts.plainSecret,
        apiFetch: await internalHttp.createSignedFetchFromClientId(fetchWithClientId),
      });

      return results;
    },

    delete: async (opts: PropagateServiceDeleteOptions) => {
      const fetchWithClientId = opts.useClientId ? opts.useClientId : opts.propagateClientId;

      const results = await hmacAuth.propagateClientToApis({
        operation: "delete",
        targets: opts.targetApis,
        clientId: opts.propagateClientId,
        apiFetch: await internalHttp.createSignedFetchFromClientId(fetchWithClientId),
      });

      return results;
    },

    health: async (opts: PropagateServiceHealthOptions) => {
      const results = await hmacAuth.propagateClientToApis({
        operation: "health",
        targets: opts.targetApis,
        apiFetch: await internalHttp.createSignedFetchFromClientId(opts.useClientId),
      });

      return results;
    },
  },
};
