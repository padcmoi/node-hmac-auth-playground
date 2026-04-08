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

function readQueryString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeClaimedClientId(value: unknown): string | undefined {
  const raw = readQueryString(value);
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

function extractMessageVerification(body: unknown): unknown {
  if (!body || typeof body !== "object") {
    return null;
  }
  return (body as Record<string, unknown>).messageVerification ?? null;
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
  async callPeerPost(@Body() payload: unknown, @Query("q") qInput: unknown, @Query("authCase") authCaseInput: unknown, @Query("keyid") keyIdInput: unknown, @Res({ passthrough: true }) res: any) {
    try {
      const q = readQueryString(qInput) ?? "123";
      const messageProof = await this.runtime.createOutboundMessageProof(q, readQueryString(authCaseInput), normalizeClaimedClientId(keyIdInput));

      const response = await this.runtime.callPeer(`${this.runtime.peerBaseUrl}/secure/post`, {
        method: "POST",
        body: JSON.stringify({
          from: this.runtime.apiName,
          payload: payload ?? null,
          messageProof,
        }),
        headers: {
          "content-type": "application/json",
        },
      });
      const body = await parseResponseBody(response);
      const messageVerification = extractMessageVerification(body);
      res.status(response.status);
      return {
        ok: response.ok,
        caller: this.runtime.apiName,
        q,
        authCase: messageProof.authCase,
        keyId: messageProof.clientId,
        messageVerification,
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
  async securePost(@Req() req: any, @Body() body: unknown) {
    const auth = (req as any).hmacAuth ?? null;
    const parsedBody = asRecord(body);
    const messageVerification = await this.runtime.verifyInboundMessageProof(parsedBody?.messageProof);
    return {
      ok: true,
      api: this.runtime.apiName,
      mode: "secure",
      method: "POST",
      body: parsedBody,
      auth,
      messageVerification,
    };
  }
}
