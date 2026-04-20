import { InitializedHmacHttpAuth } from "@naskot/node-hmac-auth";
import type { SharedApiConfig } from "../config/shared.config.js";
import type { PeerCallResult, RuntimeContext } from "./runtime-context.js";

type SharedOperation = "health" | "create" | "update" | "delete";

function parseOperation(value: string | undefined): SharedOperation {
  if (value === "health" || value === "create" || value === "update" || value === "delete") {
    return value;
  }
  return "create";
}

function parseExpiresAt(value: string | undefined): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "null") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

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

interface RuntimeBuilderDeps {
  config: SharedApiConfig;
  hmacAuth: InitializedHmacHttpAuth;
}

const DEFAULT_PROPAGATION_ALLOWED_IPS = ["172.0.0.0/8"];

function resolvePropagationAllowedIps(fromPayload: string[] | undefined): string[] {
  const deduped = Array.from(new Set((fromPayload ?? []).map((value) => value.trim()).filter(Boolean)));
  if (deduped.length > 0) {
    return deduped;
  }

  const fromEnv = (process.env.HMAC_PROPAGATION_ALLOWED_IPS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) {
    return fromEnv;
  }

  return DEFAULT_PROPAGATION_ALLOWED_IPS;
}

export function createRuntimeContext({ config, hmacAuth }: RuntimeBuilderDeps): RuntimeContext {
  return {
    apiName: config.apiName,
    namespace: config.hmacNamespace,
    peerApis: config.peerApis,
    internalManagementRoute: config.internalManagementRoute,
    callPeersWithKey: async (keyId: string, q: string): Promise<PeerCallResult[]> => {
      if (config.peerApis.length === 0) {
        throw new Error("No peers configured (PEER_APIS is empty)");
      }

      const localClient = await hmacAuth.clients.get(keyId);
      if (!localClient) {
        throw new Error(`Local client '${keyId}' not found in namespace '${config.hmacNamespace}'`);
      }

      const signedPeerFetch = hmacAuth.createHttpSignedFetchClient({
        clientId: keyId,
        secret: localClient.secretHash,
        secretIsHashed: true,
      });

      const results = await Promise.all(
        config.peerApis.map(async (peerApi): Promise<PeerCallResult> => {
          const targetUrl = `${peerApi}/secure/shared-post?q=${encodeURIComponent(q)}&from=${encodeURIComponent(config.apiName)}`;
          try {
            const response = await signedPeerFetch(targetUrl, {
              method: "POST",
              body: {
                from: config.apiName,
                q,
              },
            });

            const body = await parseResponseBody(response);
            return {
              peerApi,
              targetUrl,
              ok: response.ok,
              status: response.status,
              body,
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

      return results;
    },
    propagateClient: async (payload): Promise<Record<string, unknown>> => {
      const operation = parseOperation(payload.operation);
      const clientId = payload.clientId;
      const plainSecret = payload.secret;
      const inputSecretHash = payload.secretHash;
      const useClientId = payload.useClientId;
      const targets = payload.target ?? [];
      const allowedIps = resolvePropagationAllowedIps(payload.allowedIps);
      const expiresAt = parseExpiresAt(payload.expiresAt);

      if (!clientId) {
        return {
          ok: false,
          api: config.apiName,
          message: "Missing required query param: clientId",
        };
      }

      if (targets.length === 0) {
        return {
          ok: false,
          api: config.apiName,
          message: "Missing required query param: target (repeat target=url or use comma-separated values)",
        };
      }

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
      const payloadAllowedIps = operation === "create" || operation === "update" ? allowedIps : undefined;

      const signerClientId = useClientId ?? clientId;
      const signerClient = await hmacAuth.clients.get(signerClientId);

      if (!signerClient) {
        return {
          ok: false,
          api: config.apiName,
          message: `Signer client '${signerClientId}' not found locally`,
        };
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
        allowedIps: payloadAllowedIps,
        expiresAt,
        apiFetch,
      });

      const accepted = results.filter((item: { accepted: boolean }) => item.accepted).length;
      return {
        ok: accepted === results.length,
        api: config.apiName,
        operation,
        clientId,
        useClientId: useClientId ?? null,
        signerClientId,
        targets,
        allowedIps: payloadAllowedIps ?? null,
        total: results.length,
        accepted,
        rejected: results.length - accepted,
        propagatedSecretHash: payloadSecretHash ?? null,
        results,
      };
    },
  };
}
