import express from "express";
import { captureRawBody } from "@naskot/node-hmac-auth";
import type { SharedController } from "../controllers/controller.types";

interface SharedRoutesDeps {
  hmacAuth: any;
  controller: SharedController;
}

export function createSharedExpressApp({ hmacAuth, controller }: SharedRoutesDeps): express.Express {
  const app = express();

  app.use(
    express.json({
      verify: (req, res, buf) => captureRawBody(req as any, res, buf),
    }),
  );

  app.use(hmacAuth.createInternalManagementMiddleware());
  app.use("/secure", hmacAuth.createHttpMiddleware());

  app.get("/public/call-shared-get", controller.callSharedGet);
  app.get("/public/propagate-client", controller.propagateClient);
  app.post("/secure/shared-post", controller.secureSharedPost);

  return app;
}
