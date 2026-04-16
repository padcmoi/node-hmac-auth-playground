import { createClient } from "redis";
import { CreateHmacClientOptions, initializeHmacHttpAuth, SignedHttpFetchClientCallOptions } from "@naskot/node-hmac-auth";

const redis = createClient({
  url: process.env.REDIS_URL, // ex: redis://user:password@127.0.0.1:6379
});

await redis.connect();

export const hmacAuth = initializeHmacHttpAuth({
  redis,
  namespace: "my-api-prod",
  maxSkewMs: 5 * 60 * 1000,
  defaultSecretLengthBytes: 32,
  secretToken: process.env.HMAC_SECRET_TOKEN, // strongly recommended
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

    // Example anti-bruteforce / ban pipeline:
    // await redis.incr(`ban:hmac:${ip}`);
    // await redis.expire(`ban:hmac:${ip}`, 60);
  },
});

/**
 * Create a client credential only if it does not already exist.
 *
 * Usage:
 * await create({
 *   clientId: "client_mobile",
 *   plainSecret: "superSharedSecret",
 *   expiresAt: null,
 * });
 */
export async function create(opts: CreateHmacClientOptions) {
  const existing = await hmacAuth.clients.get(opts.clientId);
  if (existing) {
    return existing;
  }

  return await hmacAuth.clients.create(opts);
}

/**
 * Express middleware helper for protected routes.
 *
 * Usage:
 * app.use("/secure", verifyHmacMiddleware);
 */
export const verifyHmacMiddleware = hmacAuth.verifyHttpRequest;

/**
 * Signed fetch helper using a client secretHash from Redis.
 *
 * Usage:
 * const response = await signedFetch(
 *   "http://api_shared_2:3022/secure/shared-post?q=123",
 *   "client_mobile",
 *   { method: "POST", body: { from: "api_shared_1", q: "123" } },
 * );
 */
export async function signedFetch(input: string, clientId: string, options?: SignedHttpFetchClientCallOptions) {
  const client = await hmacAuth.clients.get(clientId);
  if (!client) {
    throw new Error(`${clientId} not found in Redis`);
  }

  const peerFetch = hmacAuth.createHttpSignedFetchClient({
    clientId,
    secret: client.secretHash,
    secretIsHashed: true,
  });

  return peerFetch(input, options);
}
