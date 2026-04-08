export const RUNTIME_CONTEXT = Symbol("RUNTIME_CONTEXT");

export type MessageAuthCase = "valid" | "invalid-signature" | "unknown-client";

export interface OutboundMessageProof {
  clientId: string;
  message: string;
  signature: string;
  authCase: MessageAuthCase;
}

export interface MessageVerificationResult {
  isAuthentic: boolean;
  clientId?: string;
  message?: unknown;
  authCase?: string;
  reason?: string;
}

export interface RuntimeContext {
  apiName: string;
  peerBaseUrl: string;
  callPeer: (url: string, options: RequestInit) => Promise<Response>;
  createOutboundMessageProof: (message: string, authCase?: string, claimedClientId?: string) => Promise<OutboundMessageProof>;
  verifyInboundMessageProof: (proof: unknown) => Promise<MessageVerificationResult>;
}
