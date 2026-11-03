import { describe, expect, it, vi } from "vitest";
import { validateCreateCategoryInput } from "@/lib/category-validation";
import {
  buildCreateCategoryQuery,
  getActiveCategories,
  createCategory
} from "@/lib/category-queries";

describe("Category validation (S1-08)", () => {

  it("accepts a valid category", () => {
    const category = {
      name: "Drones",
      description: "Unmanned aerial vehicles"
    };

    expect(validateCreateCategoryInput(category)).toEqual([]);
  });

  it("rejects an empty category name", () => {
    const category = {
      name: ""
    };

    expect(validateCreateCategoryInput(category))
      .toContain("Category name is required.");
  });

  it("accepts a name with exactly 100 characters", () => {
    const category = {
      name: "A".repeat(100)
    };

    expect(validateCreateCategoryInput(category)).toEqual([]);
  });

  it("rejects a name longer than 100 characters", () => {
    const category = {
      name: "A".repeat(101)
    };

    expect(validateCreateCategoryInput(category))
      .toContain("Category name must not exceed 100 characters.");
  });

  it("rejects an invalid description", () => {
    const category = {
      name: "Drones",
      description: 123
    };

    expect(validateCreateCategoryInput(category))
      .toContain("Description must be a string.");
  });

});

describe("Category database functions (S1-08)", () => {

  it("uses SQL parameters when creating a category", () => {
    const query = buildCreateCategoryQuery({
      name: "Drones",
      description: "Unmanned aerial vehicles"
    });

    expect(query.text).toContain(
      "INSERT INTO public.equipment_categories"
    );

    expect(query.values).toEqual([
      "Drones",
      "Unmanned aerial vehicles"
    ]);

    // User input must not be directly inserted into SQL text.
    expect(query.text).not.toContain("Drones");
  });

  it("retrieves only active categories", async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
  expect(sql).toContain("public.equipment_categories");

  return {
    rows: [{ id: 1, name: "Cameras" }]
  };
})
    };

    const categories = await getActiveCategories(db);

    const sql = db.query.mock.calls[0][0];

    expect(sql).toContain("WHERE is_active = true");
    expect(sql).toContain("ORDER BY name ASC");

    expect(categories).toEqual([
      { id: 1, name: "Cameras" }
    ]);
  });

  it("executes the category creation query", async () => {
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
  expect(sql).toContain("INSERT INTO public.equipment_categories");

  expect(values).toEqual([
    "Drones",
    "Unmanned aerial vehicles"
  ]);

  return {
    rows: [{ id: 5, name: "Drones" }]
  };
})
    };

    const result = await createCategory(db, {
      name: "Drones",
      description: "Unmanned aerial vehicles"
    });

    expect(db.query).toHaveBeenCalledTimes(1);

    expect(db.query.mock.calls[0][1]).toEqual([
      "Drones",
      "Unmanned aerial vehicles"
    ]);

    expect(result).toEqual({
      id: 5,
      name: "Drones"
    });
  });

});