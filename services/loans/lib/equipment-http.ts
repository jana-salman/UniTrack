import "server-only";
import { signInternalToken } from "@unitrack/internal-auth";
import {
  isEquipmentComponentSnapshot,
  isEquipmentItemSnapshot,
  isEquipmentStatusChangeResult,
  type UserIdentity,
} from "@unitrack/contracts";
import type { ReturnEquipmentPort, ReturnEquipmentItem, ReturnStatusChange } from "./returns/equipment-port";
import type { HandoverEquipmentPort, HandoverKitComponent } from "./handover/equipment-port";
import { LoansError, LoansConfigurationError, uncertain } from "./errors";
import { isEquipmentStatus } from "@unitrack/contracts";
export const EQUIPMENT_TIMEOUT_MS = 3000;

export interface ReservationEquipmentItem {
  id: string;
  lab_id: number;
  status: string;
  is_restricted: boolean;
}
export interface ReservationComponent {
  tracked_item_id: string;
  status: string;
  is_restricted: boolean;
}
function reservationEquipmentFailure(error: unknown): never {
  if (error instanceof LoansError && error.code === "equipment_rejected" && error.status === 404) {
    throw new LoansError(404, "equipment_missing", "Equipment item not found.");
  }
  if (error instanceof LoansConfigurationError) throw error;
  throw new LoansError(503, "reservation_equipment_unavailable", "Equipment is unavailable for reservation. Try again.");
}

// The caller supplies a VERIFIED identity. Destination is server configuration only.
// No automatic mutation retry; the persisted Saga decides when the SAME key is safe.
// Shared by the return and handover adapters (handover remaps the return wording).
async function call(identity: UserIdentity, path: string, body?: unknown, key?: string): Promise<unknown> {
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

async function getItem(identity: UserIdentity, id: string, labId: number): Promise<ReturnEquipmentItem | null> {
  try {
    const data = await call(identity, "/items/" + encodeURIComponent(id));
    if (!isEquipmentItemSnapshot(data) || data.id !== id || data.lab_id !== labId) throw uncertain();
    // Names are aggregated in web, never needed by the Saga.
    return { id, name: "", labId, status: data.status } as ReturnEquipmentItem;
  } catch (error) { if (error instanceof LoansError && error.status === 404) return null; throw error; }
}

async function changeStatus(identity: UserIdentity, input: ReturnStatusChange): Promise<{ changed: boolean }> {
  if (input.labId !== identity.lab_id || input.changedBy !== identity.sub) throw new LoansError(403, "forbidden", "Permission denied.");
  const data = await call(identity, "/items/" + encodeURIComponent(input.itemId) + "/status", { status: input.status, expectedStatus: input.expectedStatus, reason: input.reason, trackOperation: true, ...(input.expectedOperationKey === undefined ? {} : { expectedOperationKey: input.expectedOperationKey }) }, input.idempotencyKey);
  if (!isEquipmentStatusChangeResult(data) || data.itemId !== input.itemId || data.status !== input.status) throw uncertain();
  return { changed: data.changed };
}

export function equipmentHttp(identity: UserIdentity): ReturnEquipmentPort & {
  getReservationItem(id: string): Promise<ReservationEquipmentItem | null>;
  getReservationComponents(id: string): Promise<ReservationComponent[]>;
} {
  return {
    getItem: (id, labId) => getItem(identity, id, labId),
    changeStatus: input => changeStatus(identity, input),
    async getComponents() { throw new Error("Components are aggregated by the gateway."); },
    async getReservationItem(id) {
      try {
        const data = await call(identity, "/items/" + encodeURIComponent(id));
        if (!data || typeof data !== "object" || Array.isArray(data)) throw uncertain();
        const value = data as Record<string, unknown>;
        if (value.id !== id || !Number.isSafeInteger(value.lab_id) || !isEquipmentStatus(value.status) || typeof value.is_restricted !== "boolean") throw uncertain();
        return { id, lab_id: value.lab_id as number, status: value.status, is_restricted: value.is_restricted };
      } catch (error) {
        if (error instanceof LoansError && error.code === "equipment_rejected" && error.status === 404) return null;
        reservationEquipmentFailure(error);
      }
    },
    async getReservationComponents(id) {
      let data: unknown;
      try { data = await call(identity, "/items/" + encodeURIComponent(id) + "/reservation-components"); }
      catch (error) { reservationEquipmentFailure(error); }
      if (!Array.isArray(data) || !data.every(value => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        const component = value as Record<string, unknown>;
        return typeof component.tracked_item_id === "string" && isEquipmentStatus(component.status) && typeof component.is_restricted === "boolean";
      })) throw uncertain();
      return data as ReservationComponent[];
    },
  };
}

// Handover validates the submitted checklist against Equipment's authoritative
// component list. Equipment's staff-only /components endpoint is reused as is.
export function handoverEquipmentHttp(identity: UserIdentity): HandoverEquipmentPort {
  return {
    getItem: (id, labId) => getItem(identity, id, labId),
    changeStatus: input => changeStatus(identity, input),
    async getKitComponents(itemId, labId): Promise<HandoverKitComponent[]> {
      if (labId !== identity.lab_id) throw new LoansError(403, "forbidden", "Permission denied.");
      const data = await call(identity, "/items/" + encodeURIComponent(itemId) + "/components");
      if (!Array.isArray(data) || data.length > 100 || !data.every(row => isEquipmentComponentSnapshot(row)
        && typeof (row as unknown as Record<string, unknown>).is_active === "boolean"
        && typeof (row as unknown as Record<string, unknown>).is_required === "boolean")) throw uncertain();
      return (data as { id: string; component_name: string; is_active: boolean; is_required: boolean }[])
        .map(row => ({ id: row.id.toLowerCase(), name: row.component_name, isActive: row.is_active, isRequired: row.is_required }));
    },
  };
}
