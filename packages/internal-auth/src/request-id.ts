import { randomUUID } from "node:crypto";

// Bounded, header-safe tracing values. A valid ID grants no permissions.
export function isRequestId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 128 &&
    /^[A-Za-z0-9]/.test(value) && !/[^A-Za-z0-9._-]/.test(value);
}
export function getRequestId(value?: unknown): string {
  return isRequestId(value) ? value : randomUUID();
}
