import express from "express";
import { createClient } from "redis";
import { captureRawBody, initializeHmacAuth } from "@naskot/node-hmac-auth";

const API_NAME = "api_2";
const PORT = Number(process.env.PORT ?? 3002);
const REDIS_URL = process.env.REDIS_URL ?? "redis://user:password@127.0.0.1:6379";
const HMAC_NAMESPACE = process.env.HMAC_NAMESPACE ?? "hmac-lab-api2";
const PEER_BASE_URL = process.env.PEER_BASE_URL ?? "http://127.0.0.1:3001";

// Shared HMAC identity (same clientId on both APIs).
// Signing material is loaded from Redis (secretHash) only.
const HMAC_CLIENT_ID = process.env.HMAC_CLIENT_ID ?? "clientIdAbC";
const HMAC_BOOTSTRAP_SECRET = process.env.HMAC_BOOTSTRAP_SECRET ?? "superSharedSecret";
const HMAC_SECRET_TOKEN = process.env.HMAC_SECRET_TOKEN ?? "sharedHmacToken";

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

async function bootstrap(): Promise<void> {
  const redis = createClient({ url: REDIS_URL });
  redis.on("error", (error) => {
    console.error(`[${API_NAME}] Redis error:`, error);
  });
  await redis.connect();

  const hmacAuth = initializeHmacAuth({
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

    const peerFetch = hmacAuth.createSignedFetchClient({
      clientId: HMAC_CLIENT_ID,
      secret: client.secretHash,
      secretIsHashed: true,
    });

    return peerFetch(url, options);
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
      const response = await callPeer(`${PEER_BASE_URL}/secure/post`, {
        method: "POST",
        body: {
          from: API_NAME,
          payload: req.body ?? null,
        },
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

  // Secure routes: HMAC required
  app.use("/secure", hmacAuth.createExpressMiddleware());

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

  app.post("/secure/post", (req, res) => {
    const auth = (req as any).hmacAuth ?? null;
    res.json({
      ok: true,
      api: API_NAME,
      mode: "secure",
      method: "POST",
      body: req.body ?? null,
      auth,
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
