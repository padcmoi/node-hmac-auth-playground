import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createClient } from "redis";
import { initializeHmacHttpAuth } from "@naskot/node-hmac-auth";
import { AppModule } from "./modules/app.module.js";
import { readSharedApiConfig } from "./config/shared.config.js";
import { createRuntimeContext } from "./runtime/runtime-builder.js";

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

  const runtimeContext = createRuntimeContext({ config, hmacAuth });

  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(runtimeContext), {
    bodyParser: false,
    rawBody: true,
  });

  app.useBodyParser("json");
  app.use(hmacAuth.createInternalManagementMiddleware());
  app.use("/secure", hmacAuth.createHttpMiddleware());

  await app.listen(config.port, "0.0.0.0");
  console.log(`[${config.apiName}] listening on http://0.0.0.0:${config.port}`);
  console.log(`[${config.apiName}] namespace=${config.hmacNamespace}`);
  console.log(`[${config.apiName}] peers=${config.peerApis.join(",")}`);
  console.log(`[${config.apiName}] internalManagementRoute=${config.internalManagementRoute}`);
}

bootstrap().catch((error) => {
  console.error("[shared-api] bootstrap failed:", error);
  process.exit(1);
});
