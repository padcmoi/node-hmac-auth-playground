import type { Request, Response } from "express";
import type { SharedControllerDeps } from "./controller.types";
import { readQueryString, toErrorMessage } from "../utils/shared.utils";

export function createCallSharedGetController({ config, hmacAuth }: SharedControllerDeps) {
  return async function callSharedGet(req: Request, res: Response): Promise<void> {
    const keyId = readQueryString(req.query.keyId);
    const q = readQueryString(req.query.q) ?? "123";

    if (!keyId) {
      res.status(400).json({
        ok: false,
        api: config.apiName,
        message: "Missing required query param: keyId",
      });
      return;
    }
    if (config.peerApis.length === 0) {
      res.status(400).json({
        ok: false,
        api: config.apiName,
        message: "No peers configured (PEER_APIS is empty)",
      });
      return;
    }

    try {
      const localClient = await hmacAuth.clients.get(keyId);
      if (!localClient) {
        res.status(400).json({
          ok: false,
          api: config.apiName,
          keyId,
          message: `Local client '${keyId}' not found in namespace '${config.hmacNamespace}'`,
        });
        return;
      }

      const signedPeerFetch = hmacAuth.createHttpSignedFetchClient({
        clientId: keyId,
        secret: localClient.secretHash,
        secretIsHashed: true,
      });

      const results = await Promise.all(
        config.peerApis.map(async (peerApi: string) => {
          const targetUrl = `${peerApi}/secure/shared-post?q=${encodeURIComponent(q)}&from=${encodeURIComponent(config.apiName)}`;
          try {
            const response = await signedPeerFetch(targetUrl, {
              method: "POST",
              body: {
                from: config.apiName,
                q,
              },
            });
            return {
              peerApi,
              targetUrl,
              ok: response.ok,
              status: response.status,
            };
          } catch (error) {
            return {
              peerApi,
              targetUrl,
              ok: false,
              status: 0,
              error: toErrorMessage(error),
            };
          }
        }),
      );

      const succeeded = results.filter((item: { ok: boolean }) => item.ok).length;
      res.json({
        ok: succeeded === results.length,
        api: config.apiName,
        keyId,
        q,
        total: results.length,
        succeeded,
        failed: results.length - succeeded,
        results,
      });
    } catch (error) {
      res.status(502).json({
        ok: false,
        api: config.apiName,
        keyId,
        q,
        error: toErrorMessage(error),
      });
    }
  };
}
