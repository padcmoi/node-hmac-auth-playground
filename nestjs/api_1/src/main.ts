import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createClient } from "redis";
import { initializeHmacAuth } from "@naskot/node-hmac-auth";
import { AppModule } from "./app.module.js";
import type { RuntimeContext } from "./runtime-context.js";

const API_NAME = "api_1";
const PORT = Number(process.env.PORT ?? 3001);
const REDIS_URL = process.env.REDIS_URL ?? "redis://user:password@127.0.0.1:6379";
const HMAC_NAMESPACE = process.env.HMAC_NAMESPACE ?? "hmac-lab-nest-api1";
const PEER_BASE_URL = process.env.PEER_BASE_URL ?? "http://127.0.0.1:3002";
const HMAC_CLIENT_ID = process.env.HMAC_CLIENT_ID ?? "clientIdAbC";
const HMAC_BOOTSTRAP_SECRET = process.env.HMAC_BOOTSTRAP_SECRET ?? "superSharedSecret";
const HMAC_SECRET_TOKEN = process.env.HMAC_SECRET_TOKEN ?? "sharedHmacToken";

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

  const existing = await hmacAuth.clients.get(HMAC_CLIENT_ID);
  if (!existing) {
    await hmacAuth.clients.create({
      clientId: HMAC_CLIENT_ID,
      plainSecret: HMAC_BOOTSTRAP_SECRET,
    });
    console.log(`[${API_NAME}] seeded client '${HMAC_CLIENT_ID}' in namespace '${HMAC_NAMESPACE}' with default test secret`);
  }

  const runtimeContext: RuntimeContext = {
    apiName: API_NAME,
    peerBaseUrl: PEER_BASE_URL,
    callPeer: async (url, options) => {
      const client = await hmacAuth.clients.get(HMAC_CLIENT_ID);
      if (!client) {
        throw new Error(`Client '${HMAC_CLIENT_ID}' not found in Redis namespace '${HMAC_NAMESPACE}'`);
      }

      const peerFetch = hmacAuth.createSignedFetchClient({
        clientId: HMAC_CLIENT_ID,
        secret: client.secretHash,
        secretIsHashed: true,
      });

      return peerFetch(url, options as any);
    },
  };

  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(runtimeContext), {
    bodyParser: false,
    rawBody: true,
  });

  app.useBodyParser("json");

  app.use("/secure", hmacAuth.createExpressMiddleware());

  await app.listen(PORT, "0.0.0.0");
  console.log(`[${API_NAME}] listening on http://0.0.0.0:${PORT}`);
  console.log(`[${API_NAME}] namespace=${HMAC_NAMESPACE}`);
  console.log(`[${API_NAME}] peer=${PEER_BASE_URL}`);
}

bootstrap().catch((error) => {
  console.error(`[${API_NAME}] bootstrap failed:`, error);
  process.exit(1);
});
