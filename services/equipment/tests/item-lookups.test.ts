
import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({
  query: vi.fn(),
}));

// Mock PostgreSQL so these tests do not access Supabase.
vi.mock("@/lib/db", () => ({
  getDatabasePool: () => ({ query }),
}));

import { findItemByIdentifier } from "@/lib/item-lookups";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

const equipment = {
  id: UUID,
  asset_code: "EQ-001",
  name: "Arduino Uno",
  serial_number: "SN-12345",
  status: "available",
  condition: "good",
  is_restricted: false,
  lab_id: 7,
};

describe("findItemByIdentifier", () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue({ rows: [equipment] });
  });

  it("searches by UUID", async () => {
    const result = await findItemByIdentifier(UUID, 7);

    expect(result).toEqual(equipment);
    expect(query.mock.calls[0][1]).toEqual([UUID, 7, UUID]);

    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("id = $3::uuid");
  });

  it("searches by asset code", async () => {
    const result = await findItemByIdentifier("EQ-001", 7);

    expect(result).toEqual(equipment);
    expect(query.mock.calls[0][1]).toEqual([
      "EQ-001",
      7,
      null,
    ]);

    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("asset_code = $1");
  });

  it("searches by serial number", async () => {
    await findItemByIdentifier("SN-12345", 7);

    expect(query.mock.calls[0][1]).toEqual([
      "SN-12345",
      7,
      null,
    ]);

    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("serial_number = $1");
  });

  it("restricts the query to the user's laboratory", async () => {
    await findItemByIdentifier("EQ-001", 7);

    const sql = String(query.mock.calls[0][0]);

    expect(sql).toContain("lab_id = $2");
    expect(query.mock.calls[0][1][1]).toBe(7);
  });

  it("trims whitespace before searching", async () => {
    await findItemByIdentifier("  EQ-001  ", 7);

    expect(query.mock.calls[0][1][0]).toBe("EQ-001");
  });

  it("returns null when no equipment matches", async () => {
    query.mockResolvedValue({ rows: [] });

    const result = await findItemByIdentifier("UNKNOWN", 7);

    expect(result).toBeNull();
  });

  it("does not query the database for an empty identifier", async () => {
    const result = await findItemByIdentifier("   ", 7);

    expect(result).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects identifiers longer than 100 characters", async () => {
    const result = await findItemByIdentifier("A".repeat(101), 7);

    expect(result).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("passes input as a SQL parameter", async () => {
    const input = "' OR 1=1 --";

    await findItemByIdentifier(input, 7);

    const sql = String(query.mock.calls[0][0]);

    expect(sql).not.toContain(input);
    expect(query.mock.calls[0][1][0]).toBe(input);
  });
});
