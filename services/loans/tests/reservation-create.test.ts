import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserIdentity } from "@unitrack/contracts";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock("../lib/db", () => ({ getDatabasePool: () => ({ connect: mocks.connect }) }));

import { createReservation, RESTRICTED_RESERVATION_MESSAGE } from "../lib/reservations/create";
import { LoansError } from "../lib/errors";

const itemId = "11111111-1111-4111-8111-111111111111";
const componentId = "00000000-0000-4000-8000-000000000111";
const borrowerId = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-11-21T12:00:00.000Z");
const actor: UserIdentity = { kind: "user", sub: borrowerId, role: "student", lab_id: 9, rid: "request-1" };
const input = { itemId, startAt: "2026-12-05T12:00:00.000Z", endAt: "2026-12-12T12:00:00.000Z" };
const item = { id: itemId, lab_id: 9, status: "available", is_restricted: false };
const equipment = {
  getReservationItem: vi.fn(async (): Promise<typeof item | null> => item),
  getReservationComponents: vi.fn(async () => [] as { tracked_item_id: string; status: string; is_restricted: boolean }[]),
};

beforeEach(() => {
  vi.resetAllMocks();
  const client = { query: mocks.query, release: vi.fn() };
  mocks.connect.mockResolvedValue(client);
  mocks.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith("insert into public.reservations")) return { rows: [{ id: "44444444-4444-4444-8444-444444444444", item_id: values[0], borrower_id: values[1], lab_id: values[2], start_at: new Date(String(values[3])), end_at: new Date(String(values[4])), status: "confirmed" }] };
    return { rows: [] };
  });
  equipment.getReservationItem.mockResolvedValue(item);
  equipment.getReservationComponents.mockResolvedValue([]);
});

describe("createReservation", () => {
  it("creates a confirmed reservation for the authenticated borrower and lab", async () => {
    const result = await createReservation(input, actor, equipment, now);
    expect(result).toMatchObject({ item_id: itemId, borrower_id: borrowerId, lab_id: 9, status: "confirmed" });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("pg_advisory_xact_lock(hashtextextended($1, 0))"), ["loans:item:" + itemId]);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("insert into public.reservations"), [itemId, borrowerId, 9, input.startAt, input.endAt]);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("insert into public.reservation_resources"), [result.id, itemId, 9, input.startAt, input.endAt]);
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(equipment.getReservationItem).toHaveBeenCalledWith(itemId);
    expect(equipment.getReservationComponents).toHaveBeenCalledWith(itemId);
  });

  it("accepts the exact 7-day and 14-day boundaries", async () => {
    await expect(createReservation(input, actor, equipment, now)).resolves.toMatchObject({ status: "confirmed" });
  });

  it.each([
    [{ ...input, startAt: "not-a-date" }, "Choose valid start and end dates."],
    [{ ...input, startAt: "2026-11-21T11:59:59.999Z" }, "The start date cannot be in the past."],
    [{ ...input, endAt: "2026-12-12T12:00:00.001Z" }, "Reservations can be no longer than 7 days."],
    [{ ...input, startAt: "2026-12-05T12:00:00.001Z" }, "Reservations can start no more than 14 days in advance."],
    [{ ...input, endAt: input.startAt }, "The end date must be after the start date."],
  ])("rejects invalid date input", async (body, message) => {
    await expect(createReservation(body, actor, equipment, now)).rejects.toMatchObject({ message, status: 400 });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("rejects restricted equipment with the approved exact message", async () => {
    equipment.getReservationItem.mockResolvedValue({ ...item, is_restricted: true });
    await expect(createReservation(input, actor, equipment, now)).rejects.toMatchObject({ message: RESTRICTED_RESERVATION_MESSAGE, status: 403 });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it.each(["reserved", "checked_out", "overdue", "inspection_required", "under_maintenance", "lost", "retired"])("rejects %s equipment", async status => {
    equipment.getReservationItem.mockResolvedValue({ ...item, status });
    await expect(createReservation(input, actor, equipment, now)).rejects.toMatchObject({ code: "equipment_unavailable", status: 409 });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("rechecks item eligibility after acquiring its shared transaction lock", async () => {
    equipment.getReservationItem
      .mockResolvedValueOnce(item)
      .mockResolvedValueOnce({ ...item, status: "checked_out" });
    await expect(createReservation(input, actor, equipment, now))
      .rejects.toMatchObject({ status: 409, code: "equipment_unavailable" });
    expect(equipment.getReservationItem).toHaveBeenCalledTimes(2);
    expect(mocks.query).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.query).not.toHaveBeenCalledWith(expect.stringContaining("insert into public.reservations"), expect.anything());
  });

  it("rejects missing equipment and items from another lab", async () => {
    equipment.getReservationItem.mockResolvedValueOnce(null);
    await expect(createReservation(input, actor, equipment, now)).rejects.toMatchObject({ status: 404 });
    equipment.getReservationItem.mockResolvedValueOnce({ ...item, lab_id: 10 });
    await expect(createReservation(input, actor, equipment, now)).rejects.toMatchObject({ status: 403, code: "incorrect_lab" });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("rejects confirmed overlap and maps PostgreSQL exclusion failures to 409", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("select 1 from public.reservation_resources")) return { rows: [{ "?column?": 1 }] };
      return { rows: [] };
    });
    await expect(createReservation(input, actor, equipment, now)).rejects.toMatchObject({ status: 409, code: "reservation_conflict" });
    expect(mocks.query).not.toHaveBeenCalledWith(expect.stringContaining("insert into public.reservations"), expect.anything());

    mocks.query.mockReset(); mocks.connect.mockResolvedValue({ query: mocks.query, release: vi.fn() });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("insert into public.reservations")) throw Object.assign(new Error("overlap"), { code: "23P01" });
      return { rows: [] };
    });
    await expect(createReservation(input, actor, equipment, now)).rejects.toMatchObject({ status: 409, code: "reservation_conflict" });
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("takes all kit item locks in global order and preserves current status", async () => {
    equipment.getReservationComponents.mockResolvedValue([{ tracked_item_id: componentId, status: "available", is_restricted: false }]);
    const result = await createReservation(input, actor, equipment, now);
    expect(mocks.query.mock.calls.filter(([sql]) => String(sql).includes("pg_advisory_xact_lock")).map(([, values]) => values)).toEqual([
      ["loans:item:" + componentId], ["loans:item:" + itemId],
    ]);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("insert into public.reservation_resources"), [result.id, componentId, 9, input.startAt, input.endAt]);
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("equipment_items"))).toBe(false);
  });

  it("rechecks kit membership after locking and refuses a changed snapshot", async () => {
    equipment.getReservationComponents
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ tracked_item_id: componentId, status: "available", is_restricted: false }]);
    await expect(createReservation(input, actor, equipment, now))
      .rejects.toMatchObject({ status: 409, code: "kit_membership_changed" });
    expect(mocks.query).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.query).not.toHaveBeenCalledWith(expect.stringContaining("insert into public.reservations"), expect.anything());
  });

  it("rejects unauthenticated or non-student identities", async () => {
    await expect(createReservation(input, { ...actor, role: "lab_manager" }, equipment, now)).rejects.toBeInstanceOf(LoansError);
    await expect(createReservation(input, actor, equipment, now)).resolves.toBeDefined();
  });

  it("rolls back on a database failure and releases its dedicated client", async () => {
    const release = vi.fn();
    mocks.connect.mockResolvedValue({ query: mocks.query, release });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("insert into public.reservations")) throw new Error("database down");
      return { rows: [] };
    });
    await expect(createReservation(input, actor, equipment, now)).rejects.toThrow("database down");
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
});
