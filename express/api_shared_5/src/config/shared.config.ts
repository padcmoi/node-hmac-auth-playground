export interface SharedApiConfig {
  apiName: string;
  port: number;
  redisUrl: string;
  hmacNamespace: string;
  hmacSecretToken: string;
  internalManagementRoute: string;
  peerApis: string[];
}

function readEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error("[config] Missing required environment variable: " + name);
  }
  return value;
}

function readPortEnv(name: string): number {
  const raw = readEnv(name);
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error("[config] Invalid numeric environment variable " + name + ": " + raw);
  }
  return value;
}

export function readSharedApiConfig(): SharedApiConfig {
  return {
    apiName: readEnv("API_NAME"),
    port: readPortEnv("PORT"),
    redisUrl: readEnv("REDIS_URL"),
    hmacNamespace: readEnv("HMAC_NAMESPACE"),
    hmacSecretToken: readEnv("HMAC_SECRET_TOKEN"),
    internalManagementRoute: readEnv("INTERNAL_MANAGEMENT_ROUTE"),
    peerApis: readEnv("PEER_APIS")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  };
}
