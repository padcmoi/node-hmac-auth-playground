import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from "@nestjs/common";
import { RUNTIME_CONTEXT, type RuntimeContext } from "./runtime-context.js";

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

@Controller()
export class AppController {
  constructor(@Inject(RUNTIME_CONTEXT) private readonly runtime: RuntimeContext) {}

  @Get("public/ping")
  ping() {
    return {
      ok: true,
      api: this.runtime.apiName,
      mode: "public",
      peerBaseUrl: this.runtime.peerBaseUrl,
    };
  }

  @Get("public/call-peer-get")
  async callPeerGet(@Res({ passthrough: true }) res: any) {
    try {
      const response = await this.runtime.callPeer(`${this.runtime.peerBaseUrl}/secure/get?from=${this.runtime.apiName}`, {
        method: "GET",
      });
      const body = await parseResponseBody(response);
      res.status(response.status);
      return {
        ok: response.ok,
        caller: this.runtime.apiName,
        upstreamStatus: response.status,
        upstreamBody: body,
      };
    } catch (error) {
      res.status(502);
      return {
        ok: false,
        caller: this.runtime.apiName,
        error: toErrorMessage(error),
      };
    }
  }

  @Post("public/call-peer-post")
  async callPeerPost(@Body() payload: unknown, @Res({ passthrough: true }) res: any) {
    try {
      const response = await this.runtime.callPeer(`${this.runtime.peerBaseUrl}/secure/post`, {
        method: "POST",
        body: JSON.stringify({
          from: this.runtime.apiName,
          payload: payload ?? null,
        }),
        headers: {
          "content-type": "application/json",
        },
      });
      const body = await parseResponseBody(response);
      res.status(response.status);
      return {
        ok: response.ok,
        caller: this.runtime.apiName,
        upstreamStatus: response.status,
        upstreamBody: body,
      };
    } catch (error) {
      res.status(502);
      return {
        ok: false,
        caller: this.runtime.apiName,
        error: toErrorMessage(error),
      };
    }
  }

  @Get("secure/get")
  secureGet(@Req() req: any, @Query() query: Record<string, unknown>) {
    const auth = (req as any).hmacAuth ?? null;
    return {
      ok: true,
      api: this.runtime.apiName,
      mode: "secure",
      method: "GET",
      query,
      auth,
    };
  }

  @Post("secure/post")
  @HttpCode(200)
  securePost(@Req() req: any, @Body() body: unknown) {
    const auth = (req as any).hmacAuth ?? null;
    return {
      ok: true,
      api: this.runtime.apiName,
      mode: "secure",
      method: "POST",
      body: body ?? null,
      auth,
    };
  }
}
