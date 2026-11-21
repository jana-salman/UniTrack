import { describe, it, expect, vi, beforeEach } from "vitest";

// Replace the real database with a fake, so the tests need no connection.
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDatabasePool: () => ({ query }) }));

import { getCatalogue } from "@/lib/catalogue-query";

beforeEach(() => query.mockReset());

describe("catalogue query (S1-12)", () => {
  it("only asks for active items (retired items are hidden)", async () => {
    query.mockResolvedValue({ rows: [] });
    await getCatalogue("", "", 1);
    expect(query.mock.calls[0][0]).toContain("status <> 'retired'");
  });

  it("keeps expectedReturn null without reading Loans until integration", async () => {
    query.mockResolvedValue({ rows: [] });
    await getCatalogue("", "", 1);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).not.toMatch(/\bloans\b/i);
    expect(sql).toContain('NULL::text AS "expectedReturn"');
  });

  it("only returns items of the user's lab", async () => {
    query.mockResolvedValue({ rows: [] });
    await getCatalogue("", "", 7);
    expect(query.mock.calls[0][0]).toContain("i.lab_id = $3");
    expect(query.mock.calls[0][1][2]).toBe(7);
  });

  it("marks kits and restricted items for the reservation experience", async () => {
    query.mockResolvedValue({ rows: [{ id: "u1", assetCode: "KIT-01", name: "Sensor kit", category: "Kits", status: "available", expectedReturn: null, isRestricted: false, isKit: true }] });
    const [item] = await getCatalogue("", "", 7);
    expect(item).toMatchObject({ isKit: true, isRestricted: false });
    expect(String(query.mock.calls[0][0])).toContain('AS "isKit"');
    expect(String(query.mock.calls[0][0])).toContain('AS "isRestricted"');
  });

  it("passes the search and category as parameters, not inside the SQL text", async () => {
    query.mockResolvedValue({ rows: [] });
    await getCatalogue("drone", "Drones", 1);
    expect(query.mock.calls[0][1]).toEqual(["drone", "Drones", 1]);
    expect(query.mock.calls[0][0]).not.toContain("drone");
  });

  it("never asks for a borrower or any student information", async () => {
    query.mockResolvedValue({ rows: [] });
    await getCatalogue("", "", 1);
    const sql = String(query.mock.calls[0][0]).toLowerCase();
    expect(sql).not.toMatch(/borrower|user|student|email/);
  });

  it("returns the rows from the database", async () => {
    query.mockResolvedValue({
      rows: [
        { id: "u1", assetCode: "CAM-001", name: "Camera Canon", category: "Cameras", status: "checked_out", expectedReturn: null },
      ],
    });
    const items = await getCatalogue("", "", 1);
    expect(items).toHaveLength(1);
    expect(items[0].assetCode).toBe("CAM-001");
  });

  it("has labels for the new statuses lost and overdue", async () => {
    query.mockResolvedValue({
      rows: [
        { id: "1", assetCode: "A", name: "A", category: "C", status: "lost", expectedReturn: null },
        { id: "2", assetCode: "B", name: "B", category: "C", status: "overdue", expectedReturn: null },
      ],
    });
    const labels = (await getCatalogue("", "", 1)).map((i) => i.status);
    expect(labels).toEqual(["Lost", "Overdue"]);
  });

  it("shows database status values as labels (checked_out -> Borrowed)", async () => {
    query.mockResolvedValue({
      rows: [
        { id: "1", assetCode: "A", name: "A", category: "C", status: "checked_out", expectedReturn: null },
        { id: "2", assetCode: "B", name: "B", category: "C", status: "under_maintenance", expectedReturn: null },
        { id: "3", assetCode: "C", name: "C", category: "C", status: "inspection_required", expectedReturn: null },
      ],
    });
    const labels = (await getCatalogue("", "", 1)).map((i) => i.status);
    expect(labels).toEqual(["Borrowed", "Under Repair", "Inspection Required"]);
  });
});
it("always returns expectedReturn:null until Loans aggregation exists", async () => {
  query.mockResolvedValue({ rows: [{ id: "one", status: "available", expectedReturn: "old-value" }] });
  expect((await getCatalogue("", "", 1))[0].expectedReturn).toBeNull();
});
