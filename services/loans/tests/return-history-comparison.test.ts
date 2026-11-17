import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { compareReturnProblems } from "../lib/returns/history";
import { NEW_DAMAGE_NOTE, requiresInspection } from "../lib/returns/inspection";
import type { ConditionStatus } from "@unitrack/contracts";
const component = "550e8400-e29b-41d4-a716-446655440021";
const original = (status: ConditionStatus) => [{ kit_component_id: component, condition_status: status }];
const damaged = (notes: string | null = null) => [{ kit_component_id: component, condition_status: "damaged" as const, notes }];

it("requires a Good pickup comparison or explicit report before calling recorded damage new", () => {
  expect(compareReturnProblems(original("good"), damaged("Broken casing"))).toEqual([{ componentId: component, kind: "new_damage", notes: "Broken casing" }]);
  expect(compareReturnProblems(original("damaged"), damaged())).toEqual([]);
  expect(compareReturnProblems([], damaged())).toEqual([]);
  for (const prior of ["unknown", "missing"] as const) expect(compareReturnProblems(original(prior), damaged())).toEqual([]);
});
it("explicit additional damage is retained on an existing or missing baseline, with the generated prefix removed", () => {
  for (const pickup of [[], original("damaged"), original("unknown")]) {
    expect(compareReturnProblems(pickup, damaged(NEW_DAMAGE_NOTE + "\nAdditional crack"))).toEqual([{ componentId: component, kind: "new_damage", notes: "Additional crack" }]);
  }
});
it("missing components remain problems independent of damage baseline", () => {
  expect(compareReturnProblems([], [{ kit_component_id: component, condition_status: "missing", notes: "Charger absent" }])).toEqual([{ componentId: component, kind: "missing", notes: "Charger absent" }]);
});
it("read-only baseline handling never weakens conservative return inspection behavior", () => {
  expect(requiresInspection([], [{ kitComponentId: component, conditionStatus: "damaged" }])).toBe(true);
  expect(requiresInspection([], [{ kitComponentId: component, conditionStatus: "unknown" }])).toBe(true);
});
