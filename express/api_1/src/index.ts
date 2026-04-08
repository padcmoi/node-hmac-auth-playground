import express from "express";
import { createClient } from "redis";
import { captureRawBody, initializeHmacHttpAuth, initializeHmacMessageAuth } from "@naskot/node-hmac-auth";

const API_NAME = "api_1";
const PORT = Number(process.env.PORT ?? 3001);
const REDIS_URL = process.env.REDIS_URL ?? "redis://user:password@127.0.0.1:6379";
const HMAC_NAMESPACE = process.env.HMAC_NAMESPACE ?? "hmac-lab-api1";
const PEER_BASE_URL = process.env.PEER_BASE_URL ?? "http://127.0.0.1:3002";

// Shared HMAC identity (same clientId on both APIs).
// Signing material is loaded from Redis (secretHash) only.
const HMAC_CLIENT_ID = process.env.HMAC_CLIENT_ID ?? "clientIdAbC";
const HMAC_BOOTSTRAP_SECRET = process.env.HMAC_BOOTSTRAP_SECRET ?? "superSharedSecret";
const HMAC_SECRET_TOKEN = process.env.HMAC_SECRET_TOKEN ?? "sharedHmacToken";
type MessageAuthCase = "valid" | "invalid-signature" | "unknown-client";

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function parseResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    try {
      return await response.text();
    } catch {
      return null;
    }
  }
}

function readQueryString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return undefined;
}

function normalizeClaimedClientId(value: unknown): string | undefined {
  const raw = readQueryString(value);
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeMessageAuthCase(value: unknown): MessageAuthCase {
  if (value === "unknown-client") {
    return "unknown-client";
  }
  if (value === "invalid-signature" || value === "tamper-signature") {
    return "invalid-signature";
  }
  return "valid";
}

function extractMessageVerification(body: unknown): unknown {
  if (!body || typeof body !== "object") {
    return null;
  }
  return (body as Record<string, unknown>).messageVerification ?? null;
}

async function bootstrap(): Promise<void> {
  const redis = createClient({ url: REDIS_URL });
  redis.on("error", (error) => {
    console.error(`[${API_NAME}] Redis error:`, error);
  });
  await redis.connect();

  const hmacAuth = initializeHmacHttpAuth({
    redis: redis as any,
    namespace: HMAC_NAMESPACE,
    secretToken: HMAC_SECRET_TOKEN,
  });
  const hmacMessageAuth = initializeHmacMessageAuth({
    redis: redis as any,
    namespace: HMAC_NAMESPACE,
    secretToken: HMAC_SECRET_TOKEN,
  });

  async function ensureSeedClient(): Promise<void> {
    const existing = await hmacAuth.clients.get(HMAC_CLIENT_ID);
    if (existing) {
      return;
    }

    await hmacAuth.clients.create({
      clientId: HMAC_CLIENT_ID,
      plainSecret: HMAC_BOOTSTRAP_SECRET,
    });
    console.log(`[${API_NAME}] seeded client '${HMAC_CLIENT_ID}' in namespace '${HMAC_NAMESPACE}' with default test secret`);
  }

  await ensureSeedClient();

  async function callPeer(url: string, options: any): Promise<Response> {
    const client = await hmacAuth.clients.get(HMAC_CLIENT_ID);
    if (!client) {
      throw new Error(`Client '${HMAC_CLIENT_ID}' not found in Redis namespace '${HMAC_NAMESPACE}'`);
    }

    const peerFetch = hmacAuth.createHttpSignedFetchClient({
      clientId: HMAC_CLIENT_ID,
      secret: client.secretHash,
      secretIsHashed: true,
    });

    return peerFetch(url, options);
  }

  async function buildOutboundMessageProof(message: string, authCase: MessageAuthCase, claimedClientId?: string) {
    const signed = await hmacMessageAuth.signMessage({
      clientId: HMAC_CLIENT_ID,
      message,
    });

    const proof = {
      clientId: signed.clientId,
      message,
      signature: signed.signature,
      authCase,
    };

    if (claimedClientId) {
      proof.clientId = claimedClientId;
    }

    if (authCase === "invalid-signature") {
      proof.signature = `${proof.signature}x`;
    } else if (authCase === "unknown-client" && !claimedClientId) {
      proof.clientId = `${proof.clientId}-unknown`;
    }

    return proof;
  }

  async function verifyInboundMessageProof(proofInput: unknown) {
    if (!proofInput || typeof proofInput !== "object") {
      return {
        isAuthentic: false,
        reason: "Missing message proof",
      };
    }

    const proof = proofInput as Record<string, unknown>;
    const clientId = typeof proof.clientId === "string" ? proof.clientId : "";
    const signature = typeof proof.signature === "string" ? proof.signature : "";
    const message = proof.message;
    const authCase = typeof proof.authCase === "string" ? proof.authCase : undefined;

    try {
      await hmacMessageAuth.verifyMessage({
        clientId,
        message,
        signature,
      });
      return {
        isAuthentic: true,
        clientId,
        message,
        authCase,
      };
    } catch (error) {
      return {
        isAuthentic: false,
        clientId,
        message,
        authCase,
        reason: toErrorMessage(error),
      };
    }
  }

  const app = express();
  app.use(
    express.json({
      verify: (req, res, buf) => captureRawBody(req as any, res, buf),
    }),
  );

  // Public route (no HMAC)
  app.get("/public/ping", (_req, res) => {
    res.json({
      ok: true,
      api: API_NAME,
      mode: "public",
      peerBaseUrl: PEER_BASE_URL,
    });
  });

  // Public route that fetches peer secure GET route with HMAC
  app.get("/public/call-peer-get", async (_req, res) => {
    try {
      const response = await callPeer(`${PEER_BASE_URL}/secure/get?from=${API_NAME}`, {
        method: "GET",
      });
      const body = await parseResponseBody(response);
      res.status(response.status).json({
        ok: response.ok,
        caller: API_NAME,
        upstreamStatus: response.status,
        upstreamBody: body,
      });
    } catch (error) {
      res.status(502).json({
        ok: false,
        caller: API_NAME,
        error: toErrorMessage(error),
      });
    }
  });

  // Public route that fetches peer secure POST route with HMAC
  app.post("/public/call-peer-post", async (req, res) => {
    try {
      const q = readQueryString(req.query.q) ?? "123";
      const authCase = normalizeMessageAuthCase(readQueryString(req.query.authCase));
      const claimedClientId = normalizeClaimedClientId(req.query.keyid ?? req.query.keyId);
      const messageProof = await buildOutboundMessageProof(q, authCase, claimedClientId);

      const response = await callPeer(`${PEER_BASE_URL}/secure/post`, {
        method: "POST",
        body: {
          from: API_NAME,
          payload: req.body ?? null,
          messageProof,
        },
      });
      const body = await parseResponseBody(response);
      const messageVerification = extractMessageVerification(body);
      res.status(response.status).json({
        ok: response.ok,
        caller: API_NAME,
        q,
        authCase,
        keyId: messageProof.clientId,
        messageVerification,
        upstreamStatus: response.status,
        upstreamBody: body,
      });
    } catch (error) {
      res.status(502).json({
        ok: false,
        caller: API_NAME,
        error: toErrorMessage(error),
      });
    }
  });

  // Secure routes: HMAC required
  app.use("/secure", hmacAuth.createHttpMiddleware());

  app.get("/secure/get", (req, res) => {
    const auth = (req as any).hmacAuth ?? null;
    res.json({
      ok: true,
      api: API_NAME,
      mode: "secure",
      method: "GET",
      query: req.query,
      auth,
    });
  });

  app.post("/secure/post", async (req, res) => {
    const auth = (req as any).hmacAuth ?? null;
    const body = (req.body ?? null) as Record<string, unknown> | null;
    const messageVerification = await verifyInboundMessageProof(body?.messageProof);
    res.json({
      ok: true,
      api: API_NAME,
      mode: "secure",
      method: "POST",
      body,
      auth,
      messageVerification,
    });
  });

  app.listen(PORT, () => {
    console.log(`[${API_NAME}] listening on http://127.0.0.1:${PORT}`);
    console.log(`[${API_NAME}] namespace=${HMAC_NAMESPACE}`);
    console.log(`[${API_NAME}] peer=${PEER_BASE_URL}`);
  });
}

bootstrap().catch((error) => {
  console.error(`[${API_NAME}] bootstrap failed:`, error);
  process.exit(1);
});
