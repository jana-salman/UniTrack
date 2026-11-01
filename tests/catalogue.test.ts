import { describe, it, expect, vi, beforeEach } from "vitest";

// Replace the real database with a fake, so the tests need no connection.
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ pool: { query } }));

import { getCatalogue } from "@/lib/catalogue-query";
import { getMockCatalogue } from "@/lib/mock-items"; // delete this import and its tests with mock-items.ts

beforeEach(() => query.mockReset());

describe("catalogue query (S1-12)", () => {
  it("only asks for active items (retired items are hidden)", async () => {
    query.mockResolvedValue({ rows: [] });
    await getCatalogue();
    expect(query.mock.calls[0][0]).toContain("status <> 'retired'");
  });

  it("reads the due date from the active loan only", async () => {
    query.mockResolvedValue({ rows: [] });
    await getCatalogue();
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("LEFT JOIN loans");
    expect(sql).toContain("returned_at IS NULL");
  });

  it("passes the search and category as parameters, not inside the SQL text", async () => {
    query.mockResolvedValue({ rows: [] });
    await getCatalogue("drone", "Drones");
    expect(query.mock.calls[0][1]).toEqual(["drone", "Drones"]);
    expect(query.mock.calls[0][0]).not.toContain("drone");
  });

  it("never asks for a borrower or any student information", async () => {
    query.mockResolvedValue({ rows: [] });
    await getCatalogue();
    const sql = String(query.mock.calls[0][0]).toLowerCase();
    expect(sql).not.toMatch(/borrower|user|student|email/);
  });

  it("returns the rows from the database", async () => {
    query.mockResolvedValue({
      rows: [
        { id: "u1", assetCode: "CAM-001", name: "Camera Canon", category: "Cameras", status: "checked_out", expectedReturn: null },
      ],
    });
    const items = await getCatalogue();
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
    const labels = (await getCatalogue()).map((i) => i.status);
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
    const labels = (await getCatalogue()).map((i) => i.status);
    expect(labels).toEqual(["Borrowed", "Under Repair", "Inspection Required"]);
  });
});

describe("sample data filter (temporary)", () => {
  it("finds items by name, ignoring upper and lower case", () => {
    const names = getMockCatalogue("CAMERA").map((i) => i.name);
    expect(names).toEqual(["Camera Canon"]);
  });

  it("finds items by category", () => {
    const result = getMockCatalogue("", "Sensors");
    expect(result.length).toBe(2);
    expect(result.every((i) => i.category === "Sensors")).toBe(true);
  });

  it("has no borrower field on any item", () => {
    for (const item of getMockCatalogue()) {
      expect(Object.keys(item).sort()).toEqual(
        ["assetCode", "category", "expectedReturn", "id", "name", "status"]
      );
    }
  });
});