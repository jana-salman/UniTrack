import { describe, expect, it } from "vitest";

import { validateReturnChecklist } from "../lib/returns/checklist";
import type { PickupCondition } from "../lib/returns/types";

const pickup: PickupCondition[] = [
  {
    id: "record-1",
    kit_component_id: null,
    condition_status: "good",
    notes: null,
  },
  {
    id: "record-2",
    kit_component_id: "charger-id",
    condition_status: "good",
    notes: null,
  },
];

describe("return checklist", () => {
  it("accepts a complete checklist", () => {
    expect(() =>
      validateReturnChecklist(pickup, [
        { kitComponentId: null, conditionStatus: "good" },
        { kitComponentId: "charger-id", conditionStatus: "good" },
      ]),
    ).not.toThrow();
  });

  it("accepts a missing component when explicitly recorded", () => {
    expect(() =>
      validateReturnChecklist(pickup, [
        { kitComponentId: null, conditionStatus: "good" },
        { kitComponentId: "charger-id", conditionStatus: "missing" },
      ]),
    ).not.toThrow();
  });

  it("rejects a skipped component", () => {
    expect(() =>
      validateReturnChecklist(pickup, [
        { kitComponentId: null, conditionStatus: "good" },
      ]),
    ).toThrow("Check every component from the pickup record.");
  });

  it("rejects a component not present in the pickup record", () => {
    expect(() =>
      validateReturnChecklist(pickup, [
        { kitComponentId: null, conditionStatus: "good" },
        { kitComponentId: "other-id", conditionStatus: "good" },
      ]),
    ).toThrow("A checked component is not in the pickup record.");
  });

  it("requires the main item's condition", () => {
    expect(() =>
      validateReturnChecklist(pickup, [
        { kitComponentId: "charger-id", conditionStatus: "good" },
      ]),
    ).toThrow("Record the main item's return condition.");
  });

  it("rejects missing pickup records", () => {
    expect(() =>
      validateReturnChecklist([], [
        { kitComponentId: null, conditionStatus: "good" },
      ]),
    ).toThrow("The pickup condition records are missing.");
  });

  it("accepts a standalone item without kit components", () => {
    expect(() =>
      validateReturnChecklist([pickup[0]], [
        { kitComponentId: null, conditionStatus: "good" },
      ]),
    ).not.toThrow();
  });

  it("rejects checking the main item twice", () => {
    expect(() =>
      validateReturnChecklist(pickup, [
        { kitComponentId: null, conditionStatus: "good" },
        { kitComponentId: null, conditionStatus: "good" },
      ]),
    ).toThrow("The main item was checked more than once.");
  });

  it("rejects checking a component twice", () => {
    expect(() =>
      validateReturnChecklist(pickup, [
        { kitComponentId: null, conditionStatus: "good" },
        { kitComponentId: "charger-id", conditionStatus: "good" },
        { kitComponentId: "charger-id", conditionStatus: "missing" },
      ]),
    ).toThrow("A component was checked more than once.");
  });
});