import { describe, expect, it } from "vitest";

import { requiresInspection } from "../lib/returns/inspection";
import type {
  ConditionStatus,
  PickupCondition,
  ReturnConditionInput,
} from "../lib/returns/types";

function pickup(condition: ConditionStatus): PickupCondition[] {
  return [
    {
      id: "pickup-1",
      kit_component_id: null,
      condition_status: condition,
      notes: null,
    },
  ];
}

function returned(
  condition: ConditionStatus,
  newDamage = false,
): ReturnConditionInput[] {
  return [
    {
      kitComponentId: null,
      conditionStatus: condition,
      newDamage,
    },
  ];
}

describe("return inspection", () => {
  it("does not require inspection for an undamaged return", () => {
    expect(
      requiresInspection(pickup("good"), returned("good")),
    ).toBe(false);
  });

  it("requires inspection for damage not present at pickup", () => {
    expect(
      requiresInspection(pickup("good"), returned("damaged")),
    ).toBe(true);
  });

  it("does not treat unchanged existing damage as new damage", () => {
    expect(
      requiresInspection(pickup("damaged"), returned("damaged")),
    ).toBe(false);
  });

  it("requires inspection for additional damage", () => {
    expect(
      requiresInspection(pickup("damaged"), returned("damaged", true)),
    ).toBe(true);
  });

  it("requires inspection when an item needs attention", () => {
    expect(
      requiresInspection(pickup("good"), returned("unknown")),
    ).toBe(true);
  });

  it("requires inspection for a missing kit component", () => {
    const pickupRecords: PickupCondition[] = [
      ...pickup("good"),
      {
        id: "pickup-charger",
        kit_component_id: "charger-id",
        condition_status: "good",
        notes: null,
      },
    ];

    const returnRecords: ReturnConditionInput[] = [
      ...returned("good"),
      {
        kitComponentId: "charger-id",
        conditionStatus: "missing",
      },
    ];

    expect(
      requiresInspection(pickupRecords, returnRecords),
    ).toBe(true);
  });

  it("matches components by ID rather than checklist order", () => {
    const pickupRecords: PickupCondition[] = [
      {
        id: "pickup-charger",
        kit_component_id: "charger-id",
        condition_status: "damaged",
        notes: "Existing scratch",
      },
      ...pickup("good"),
    ];

    const returnRecords: ReturnConditionInput[] = [
      ...returned("good"),
      {
        kitComponentId: "charger-id",
        conditionStatus: "damaged",
        newDamage: false,
      },
    ];

    expect(
      requiresInspection(pickupRecords, returnRecords),
    ).toBe(false);
  });
});