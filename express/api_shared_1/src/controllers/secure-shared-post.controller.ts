import type { Request, Response } from "express";
import type { SharedControllerDeps } from "./controller.types";

export function createSecureSharedPostController({ config }: SharedControllerDeps) {
  return function secureSharedPost(req: Request, res: Response): void {
    const auth = (req as any).hmacAuth ?? null;
    res.json({
      ok: true,
      api: config.apiName,
      mode: "secure",
      method: "POST",
      query: req.query,
      body: req.body ?? null,
      auth,
    });
  };
}
