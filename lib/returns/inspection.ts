import type {
  PickupCondition,
  ReturnConditionInput,
} from "./types";

export function requiresInspection(
  pickupConditions: PickupCondition[],
  returnConditions: ReturnConditionInput[],
): boolean {
  return returnConditions.some((record) => {
    if (
      record.conditionStatus === "missing" ||
      record.conditionStatus === "unknown" ||
      record.newDamage === true
    ) {
      return true;
    }

    if (record.conditionStatus !== "damaged") {
      return false;
    }

    const pickup = pickupConditions.find(
      (entry) =>
        entry.kit_component_id === record.kitComponentId,
    );

    return pickup?.condition_status !== "damaged";
  });
}