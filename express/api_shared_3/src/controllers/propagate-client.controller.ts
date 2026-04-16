import type { Request, Response } from "express";
import type { SharedControllerDeps } from "./controller.types";
import { parseExpiresAt, parseOperation, readQueryString, readQueryStringList, toErrorMessage } from "../utils/shared.utils";

export function createPropagateClientController({ config, hmacAuth }: SharedControllerDeps) {
  return async function propagateClient(req: Request, res: Response): Promise<void> {
    const operation = parseOperation(readQueryString(req.query.operation));
    const clientId = readQueryString(req.query.clientId);
    const plainSecret = readQueryString(req.query.secret);
    const inputSecretHash = readQueryString(req.query.secretHash);
    const useClientId = readQueryString(req.query.useClientId);
    const targets = readQueryStringList(req.query.target);
    const expiresAt = parseExpiresAt(readQueryString(req.query.expiresAt));

    if (!clientId) {
      res.status(400).json({
        ok: false,
        api: config.apiName,
        message: "Missing required query param: clientId",
      });
      return;
    }

    if (targets.length === 0) {
      res.status(400).json({
        ok: false,
        api: config.apiName,
        message: "Missing required query param: target (repeat target=url or use comma-separated values)",
      });
      return;
    }

    try {
      const existingClient = await hmacAuth.clients.get(clientId);
      let propagatedSecretHash = inputSecretHash;

      if (operation === "create" || operation === "update") {
        if (!existingClient) {
          if (plainSecret) {
            const created = await hmacAuth.clients.create({
              clientId,
              plainSecret,
              expiresAt,
            });
            propagatedSecretHash = created.secretHash;
          } else if (inputSecretHash) {
            await hmacAuth.clients.setSecretHash(clientId, inputSecretHash, expiresAt);
            propagatedSecretHash = inputSecretHash;
          } else {
            const created = await hmacAuth.clients.create({
              clientId,
              expiresAt,
            });
            propagatedSecretHash = created.secretHash;
          }
        } else if (plainSecret) {
          await hmacAuth.clients.setSecret(clientId, plainSecret, expiresAt);
          const refreshedClient = await hmacAuth.clients.get(clientId);
          propagatedSecretHash = refreshedClient?.secretHash;
        } else if (inputSecretHash) {
          await hmacAuth.clients.setSecretHash(clientId, inputSecretHash, expiresAt);
          propagatedSecretHash = inputSecretHash;
        } else {
          propagatedSecretHash = existingClient.secretHash;
        }
      }

      const payloadSecretHash = operation === "create" || operation === "update" ? propagatedSecretHash : undefined;

      const signerClientId = useClientId ?? clientId;
      const signerClient = await hmacAuth.clients.get(signerClientId);

      if (!signerClient) {
        res.status(400).json({
          ok: false,
          api: config.apiName,
          message: `Signer client '${signerClientId}' not found locally`,
        });
        return;
      }

      const apiFetch = (url: string, options: RequestInit) => {
        const signedFetch = hmacAuth.createHttpSignedFetchClient({
          clientId: signerClientId,
          secret: signerClient.secretHash,
          secretIsHashed: true,
        });
        return signedFetch(url, options as any);
      };

      const results = await hmacAuth.propagateClientToApis({
        operation,
        targets,
        clientId,
        secretHash: payloadSecretHash,
        expiresAt,
        apiFetch,
      });

      const accepted = results.filter((item: { accepted: boolean }) => item.accepted).length;
      res.json({
        ok: accepted === results.length,
        api: config.apiName,
        operation,
        clientId,
        useClientId: useClientId ?? null,
        signerClientId,
        targets,
        total: results.length,
        accepted,
        rejected: results.length - accepted,
        propagatedSecretHash: payloadSecretHash ?? null,
        results,
      });
    } catch (error) {
      res.status(502).json({
        ok: false,
        api: config.apiName,
        operation,
        clientId,
        useClientId: useClientId ?? null,
        targets,
        error: toErrorMessage(error),
      });
    }
  };
}
