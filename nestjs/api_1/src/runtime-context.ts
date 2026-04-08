export const RUNTIME_CONTEXT = Symbol("RUNTIME_CONTEXT");

export interface RuntimeContext {
  apiName: string;
  peerBaseUrl: string;
  callPeer: (url: string, options: RequestInit) => Promise<Response>;
}
