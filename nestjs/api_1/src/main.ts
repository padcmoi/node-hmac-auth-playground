import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createClient } from "redis";
import { initializeHmacHttpAuth, initializeHmacMessageAuth } from "@naskot/node-hmac-auth";
import { AppModule } from "./app.module.js";
import type { MessageAuthCase, RuntimeContext } from "./runtime-context.js";

const API_NAME = "api_1";
const PORT = Number(process.env.PORT ?? 3001);
const REDIS_URL = process.env.REDIS_URL ?? "redis://user:password@127.0.0.1:6379";
const HMAC_NAMESPACE = process.env.HMAC_NAMESPACE ?? "hmac-lab-nest-api1";
const PEER_BASE_URL = process.env.PEER_BASE_URL ?? "http://127.0.0.1:3002";
const HMAC_CLIENT_ID = process.env.HMAC_CLIENT_ID ?? "clientIdAbC";
const HMAC_BOOTSTRAP_SECRET = process.env.HMAC_BOOTSTRAP_SECRET ?? "superSharedSecret";
const HMAC_SECRET_TOKEN = process.env.HMAC_SECRET_TOKEN ?? "sharedHmacToken";

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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

function normalizeClaimedClientId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
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
  const hmacMessageAuth = initializeHmacMessageAuth({
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

      const peerFetch = hmacAuth.createHttpSignedFetchClient({
        clientId: HMAC_CLIENT_ID,
        secret: client.secretHash,
        secretIsHashed: true,
      });

      return peerFetch(url, options as any);
    },
    createOutboundMessageProof: async (message, authCaseInput, claimedClientIdInput) => {
      const authCase = normalizeMessageAuthCase(authCaseInput);
      const claimedClientId = normalizeClaimedClientId(claimedClientIdInput);
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
    },
    verifyInboundMessageProof: async (proofInput) => {
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
    },
  };

  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(runtimeContext), {
    bodyParser: false,
    rawBody: true,
  });

  app.useBodyParser("json");

  app.use("/secure", hmacAuth.createHttpMiddleware());

  await app.listen(PORT, "0.0.0.0");
  console.log(`[${API_NAME}] listening on http://0.0.0.0:${PORT}`);
  console.log(`[${API_NAME}] namespace=${HMAC_NAMESPACE}`);
  console.log(`[${API_NAME}] peer=${PEER_BASE_URL}`);
}

bootstrap().catch((error) => {
  console.error(`[${API_NAME}] bootstrap failed:`, error);
  process.exit(1);
});
