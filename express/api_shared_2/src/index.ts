import { createClient } from "redis";
import { initializeHmacHttpAuth } from "@naskot/node-hmac-auth";
import { readSharedApiConfig } from "./config/shared.config";
import { createSharedController } from "./controllers";
import { createSharedExpressApp } from "./routes/shared.routes";

async function bootstrap(): Promise<void> {
  const config = readSharedApiConfig();

  const redis = createClient({ url: config.redisUrl });
  redis.on("error", (error) => {
    console.error(`[${config.apiName}] Redis error:`, error);
  });
  await redis.connect();

  const hmacAuth = initializeHmacHttpAuth({
    redis: redis as any,
    namespace: config.hmacNamespace,
    secretToken: config.hmacSecretToken,
    internalManagementRoute: config.internalManagementRoute,
  });

  const controller = createSharedController({ config, hmacAuth });
  const app = createSharedExpressApp({ hmacAuth, controller });

  app.listen(config.port, () => {
    console.log(`[${config.apiName}] listening on http://127.0.0.1:${config.port}`);
    console.log(`[${config.apiName}] namespace=${config.hmacNamespace}`);
    console.log(`[${config.apiName}] peers=${config.peerApis.join(",")}`);
    console.log(`[${config.apiName}] internalManagementRoute=${config.internalManagementRoute}`);
  });
}

bootstrap().catch((error) => {
  console.error("[shared-api] bootstrap failed:", error);
  process.exit(1);
});
