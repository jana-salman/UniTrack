import "server-only";
import { signInternalToken } from "@unitrack/internal-auth";
import {
  isEquipmentItemSnapshot,
  isEquipmentStatusChangeResult,
  type UserIdentity,
} from "@unitrack/contracts";
import type { ReturnEquipmentPort, ReturnEquipmentItem } from "./returns/equipment-port";
import { LoansError, LoansConfigurationError, uncertain } from "./errors";
export const EQUIPMENT_TIMEOUT_MS = 3000;

// The caller supplies a VERIFIED identity. Destination is server configuration only.
// No automatic mutation retry; the persisted Saga decides when the SAME key is safe.
export function equipmentHttp(identity: UserIdentity): ReturnEquipmentPort {
  async function call(path: string, body?: unknown, key?: string): Promise<unknown> {
    let base: URL;
    const secret = process.env.INTERNAL_JWT_SECRET;
    try {
      base = new URL(process.env.EQUIPMENT_SERVICE_URL ?? "");
      if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.pathname !== "/" || base.search || base.hash || !secret?.trim()) throw 0;
    } catch { throw new LoansConfigurationError("equipment"); }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EQUIPMENT_TIMEOUT_MS);
    try {
      const token = await signInternalToken(identity, secret!);
      const response = await fetch(new URL(path, base), {
        method: body === undefined ? "GET" : "PATCH", redirect: "error", cache: "no-store", credentials: "omit", signal: controller.signal,
        headers: { Authorization: "Bearer " + token, "X-Request-Id": identity.rid, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(key ? { "Idempotency-Key": key } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) throw new LoansError(response.status === 404 ? 404 : 409, "equipment_rejected", "Equipment rejected the return operation. Verify its status before retrying.");
        throw uncertain();
      }
      if (!response.headers.get("content-type")?.includes("application/json")) throw uncertain();
      // The timeout includes parsing the body. Never expose upstream text/headers/errors.
      const data: unknown = await response.json();
      return data;
    } catch (error) {
      if (error instanceof LoansError) throw error;
      throw uncertain();
    } finally { clearTimeout(timer); controller.abort(); }
  }
  return {
    async getItem(id, labId) {
      try {
        const data = await call("/items/" + encodeURIComponent(id));
        if (!isEquipmentItemSnapshot(data) || data.id !== id || data.lab_id !== labId) throw uncertain();
        // Names are aggregated in web, never needed by the Saga.
        return { id, name: "", labId, status: data.status } as ReturnEquipmentItem;
      } catch (error) { if (error instanceof LoansError && error.status === 404) return null; throw error; }
    },
    async changeStatus(input) {
      if (input.labId !== identity.lab_id || input.changedBy !== identity.sub) throw new LoansError(403, "forbidden", "Permission denied.");
      const data = await call("/items/" + encodeURIComponent(input.itemId) + "/status", { status: input.status, expectedStatus: input.expectedStatus, reason: input.reason, trackOperation: true, ...(input.expectedOperationKey === undefined ? {} : { expectedOperationKey: input.expectedOperationKey }) }, input.idempotencyKey);
      if (!isEquipmentStatusChangeResult(data) || data.itemId !== input.itemId || data.status !== input.status) throw uncertain();
      return { changed: data.changed };
    },
    async getComponents() { throw new Error("Components are aggregated by the gateway."); },
  };
}
