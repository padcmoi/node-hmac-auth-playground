export const RUNTIME_CONTEXT = Symbol("RUNTIME_CONTEXT");

export interface PeerCallResult {
  peerApi: string;
  targetUrl: string;
  ok: boolean;
  status: number;
  body?: unknown;
  error?: string;
}

export interface PropagatePayload {
  operation?: string;
  clientId?: string;
  secret?: string;
  secretHash?: string;
  useClientId?: string;
  target?: string[];
  expiresAt?: string;
}

export interface RuntimeContext {
  apiName: string;
  namespace: string;
  peerApis: string[];
  internalManagementRoute: string;
  callPeersWithKey: (keyId: string, q: string) => Promise<PeerCallResult[]>;
  propagateClient: (payload: PropagatePayload) => Promise<Record<string, unknown>>;
}
