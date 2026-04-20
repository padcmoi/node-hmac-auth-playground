import { Controller, Get, Inject, Post, Query, Req, Res } from "@nestjs/common";
import { RUNTIME_CONTEXT, type PropagatePayload, type RuntimeContext } from "../runtime/runtime-context.js";
import { readQueryString, readQueryStringList, toErrorMessage } from "../common/controller.utils.js";

@Controller()
export class AppController {
  constructor(@Inject(RUNTIME_CONTEXT) private readonly runtime: RuntimeContext) {}

  @Get("public/call-shared-get")
  async callSharedGet(@Query("keyId") keyIdInput: unknown, @Query("q") qInput: unknown, @Res({ passthrough: true }) res: any) {
    const keyId = readQueryString(keyIdInput);
    const q = readQueryString(qInput) ?? "123";

    if (!keyId) {
      res.status(400);
      return {
        ok: false,
        api: this.runtime.apiName,
        message: "Missing required query param: keyId",
      };
    }

    try {
      const results = await this.runtime.callPeersWithKey(keyId, q);
      const succeeded = results.filter((item) => item.ok).length;
      return {
        ok: succeeded === results.length,
        api: this.runtime.apiName,
        keyId,
        q,
        total: results.length,
        succeeded,
        failed: results.length - succeeded,
        results,
      };
    } catch (error) {
      res.status(502);
      return {
        ok: false,
        api: this.runtime.apiName,
        keyId,
        q,
        error: toErrorMessage(error),
      };
    }
  }

  @Get("public/propagate-client")
  async propagateClient(@Query() query: Record<string, unknown>, @Res({ passthrough: true }) res: any) {
    try {
      const allowedIps = Array.from(
        new Set([...readQueryStringList(query.allowedIp), ...readQueryStringList(query.allowedIps)]),
      );

      const payload: PropagatePayload = {
        operation: readQueryString(query.operation),
        clientId: readQueryString(query.clientId),
        secret: readQueryString(query.secret),
        secretHash: readQueryString(query.secretHash),
        allowedIps,
        useClientId: readQueryString(query.useClientId),
        target: readQueryStringList(query.target),
        expiresAt: readQueryString(query.expiresAt),
      };

      return await this.runtime.propagateClient(payload);
    } catch (error) {
      res.status(502);
      return {
        ok: false,
        api: this.runtime.apiName,
        error: toErrorMessage(error),
      };
    }
  }

  @Post("secure/shared-post")
  secureSharedPost(@Req() req: any) {
    const auth = (req as any).hmacAuth ?? null;
    return {
      ok: true,
      api: this.runtime.apiName,
      mode: "secure",
      method: "POST",
      query: req.query,
      body: req.body ?? null,
      auth,
    };
  }
}
