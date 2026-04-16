import type { SharedOperation } from "../types/shared.types";

export function readQueryString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return undefined;
}

export function readQueryStringList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return values
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseOperation(value: string | undefined): SharedOperation {
  if (value === "health" || value === "create" || value === "update" || value === "delete") {
    return value;
  }
  return "create";
}

export function parseExpiresAt(value: string | undefined): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "null") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
