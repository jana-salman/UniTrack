import "server-only";
import type { PoolClient } from "pg";
import type { UserIdentity } from "@unitrack/contracts";
import { getDatabasePool } from "../db";
import { LoansError } from "../errors";
import type { ReservationComponent, ReservationEquipmentItem } from "../equipment-http";

export const RESTRICTED_RESERVATION_MESSAGE =
  "This item requires approval and cannot currently be reserved through UniTrack.";
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DURATION_MS = 7 * DAY_MS;
const MAX_ADVANCE_MS = 14 * DAY_MS;
const CONFLICT_MESSAGE = "This item or one of its tracked kit components is already reserved for part of those dates.";

export interface ReservationEquipmentPort {
  getReservationItem(id: string): Promise<ReservationEquipmentItem | null>;
  getReservationComponents(id: string): Promise<ReservationComponent[]>;
}

export interface ReservationResult {
  id: string;
  item_id: string;
  borrower_id: string;
  lab_id: number;
  start_at: string;
  end_at: string;
  status: "confirmed";
}

interface ReservationInput { itemId: string; startAt: string; endAt: string }

function invalid(message: string): never {
  throw new LoansError(400, "invalid_reservation", message);
}

function parseInput(value: unknown, now: Date): ReservationInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Choose an item and valid start and end dates.");
  const body = value as Record<string, unknown>;
  if (typeof body.itemId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.itemId)) invalid("Choose a valid equipment item or kit.");
  if (typeof body.startAt !== "string" || typeof body.endAt !== "string") invalid("Choose valid start and end dates.");
  const start = Date.parse(body.startAt);
  const end = Date.parse(body.endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) invalid("Choose valid start and end dates.");
  if (end <= start) invalid("The end date must be after the start date.");
  if (start < now.getTime()) invalid("The start date cannot be in the past.");
  if (end - start > MAX_DURATION_MS) invalid("Reservations can be no longer than 7 days.");
  if (start - now.getTime() > MAX_ADVANCE_MS) invalid("Reservations can start no more than 14 days in advance.");
  return { itemId: body.itemId, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() };
}

export async function createReservation(
  value: unknown,
  actor: UserIdentity,
  equipment: ReservationEquipmentPort,
  now = new Date(),
): Promise<ReservationResult> {
  if (actor.kind !== "user" || actor.role !== "student") throw new LoansError(403, "forbidden", "Permission denied.");
  const input = parseInput(value, now);

  const item = await equipment.getReservationItem(input.itemId);
  if (!item) throw new LoansError(404, "equipment_missing", "Equipment item not found.");
  if (item.lab_id !== actor.lab_id) throw new LoansError(403, "incorrect_lab", "This item is not available in your laboratory.");
  if (item.is_restricted) throw new LoansError(403, "restricted_equipment", RESTRICTED_RESERVATION_MESSAGE);
  if (item.status !== "available") throw new LoansError(409, "equipment_unavailable", "This item is not currently available for reservation.");

  const client: PoolClient = await getDatabasePool().connect();
  let transaction = false;
  try {
    await client.query("BEGIN");
    transaction = true;
    // The requested item is always locked first with the exact S2-09 key.
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", ["loans:item:" + input.itemId.toLowerCase()]);

    // Kit membership is read only after the main-item lock. Equipment kit
    // mutation triggers take the same lock, so this component snapshot stays
    // stable until this reservation commits.
    const components = await equipment.getReservationComponents(input.itemId);
    for (const component of components) {
      if (component.is_restricted) throw new LoansError(403, "restricted_equipment", RESTRICTED_RESERVATION_MESSAGE);
      if (component.status !== "available") throw new LoansError(409, "equipment_unavailable", "A tracked component of this kit is not currently available for reservation.");
    }
    const componentIds = [...new Set(components.map(component => component.tracked_item_id.toLowerCase()))].sort();
    for (const id of componentIds) {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", ["loans:item:" + id]);
    }
    const resourceIds = [input.itemId, ...componentIds];

    const overlap = await client.query(
      `select 1 from public.reservation_resources
       where resource_item_id = any($1::uuid[])
         and status = 'confirmed'
         and tstzrange(start_at, end_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')
       limit 1`,
      [resourceIds, input.startAt, input.endAt],
    );
    if (overlap.rows.length) throw new LoansError(409, "reservation_conflict", CONFLICT_MESSAGE);

    const saved = await client.query<ReservationResult>(
      `insert into public.reservations (item_id, borrower_id, lab_id, start_at, end_at, status)
       values ($1, $2, $3, $4, $5, 'confirmed')
       returning id, item_id, borrower_id, lab_id, start_at, end_at, status`,
      [input.itemId, actor.sub, actor.lab_id, input.startAt, input.endAt],
    );
    const reservation = saved.rows[0];
    if (!reservation) throw new Error("Reservation insert returned no row.");

    for (const resourceId of resourceIds) {
      await client.query(
        `insert into public.reservation_resources
         (reservation_id, resource_item_id, lab_id, start_at, end_at, status)
         values ($1, $2, $3, $4, $5, 'confirmed')`,
        [reservation.id, resourceId, actor.lab_id, input.startAt, input.endAt],
      );
    }

    await client.query("COMMIT");
    transaction = false;
    return {
      ...reservation,
      start_at: new Date(reservation.start_at).toISOString(),
      end_at: new Date(reservation.end_at).toISOString(),
      status: "confirmed",
    };
  } catch (error) {
    if (transaction) await client.query("ROLLBACK").catch(() => undefined);
    if (error && typeof error === "object" && "code" in error && error.code === "23P01") {
      throw new LoansError(409, "reservation_conflict", CONFLICT_MESSAGE);
    }
    if (error instanceof LoansError) throw error;
    throw error;
  } finally {
    client.release();
  }
}
