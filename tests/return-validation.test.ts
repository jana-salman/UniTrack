import { describe, expect, it } from "vitest";

import { validateReturnInput } from "../lib/returns/validation";

describe("return validation", () => {
  it("accepts a main item and a component", () => {
    const result = validateReturnInput({
      conditions: [
        {
          kitComponentId: null,
          conditionStatus: "good",
        },
        {
          kitComponentId: "charger-id",
          conditionStatus: "missing",
          notes: " Charger not returned ",
        },
      ],
    });

    expect(result.conditions).toHaveLength(2);
    expect(result.conditions[1].notes).toBe("Charger not returned");
  });

  it("rejects an empty checklist", () => {
    expect(() =>
      validateReturnInput({ conditions: [] }),
    ).toThrow("Record the return condition before confirming.");
  });

  it("rejects an invalid condition", () => {
    expect(() =>
      validateReturnInput({
        conditions: [
          { kitComponentId: null, conditionStatus: "excellent" },
        ],
      }),
    ).toThrow("Choose a valid condition.");
  });

  it("rejects duplicate main-item checks", () => {
    expect(() =>
      validateReturnInput({
        conditions: [
          { kitComponentId: null, conditionStatus: "good" },
          { kitComponentId: null, conditionStatus: "damaged" },
        ],
      }),
    ).toThrow("Each item or component must be checked only once.");
  });

  it("rejects duplicate component checks", () => {
    expect(() =>
      validateReturnInput({
        conditions: [
          { kitComponentId: "charger-id", conditionStatus: "good" },
          { kitComponentId: "charger-id", conditionStatus: "missing" },
        ],
      }),
    ).toThrow("Each item or component must be checked only once.");
  });

  it("rejects a missing component identifier", () => {
    expect(() =>
      validateReturnInput({
        conditions: [{ conditionStatus: "good" }],
      }),
    ).toThrow("Invalid kit component ID.");
  });

  it("rejects non-text notes", () => {
    expect(() =>
      validateReturnInput({
        conditions: [
          {
            kitComponentId: null,
            conditionStatus: "good",
            notes: 123,
          },
        ],
      }),
    ).toThrow("Condition notes must be text.");
  });
});