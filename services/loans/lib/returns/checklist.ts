import type {
  PickupCondition,
  ReturnConditionInput,
} from "./types";

export function validateReturnChecklist(
  pickupConditions: PickupCondition[],
  returnConditions: ReturnConditionInput[],
): void {
  if (pickupConditions.length === 0) {
    throw new Error("The pickup condition records are missing.");
  }

  const expectedComponents = new Set(
    pickupConditions
      .map((record) => record.kit_component_id)
      .filter((id): id is string => id !== null),
  );

  const checkedComponents = new Set<string>();
  let mainItemChecked = false;

  for (const record of returnConditions) {
    const componentId = record.kitComponentId;

    if (componentId === null) {
      if (mainItemChecked) {
        throw new Error("The main item was checked more than once.");
      }

      mainItemChecked = true;
      continue;
    }

    if (!expectedComponents.has(componentId)) {
      throw new Error("A checked component is not in the pickup record.");
    }

    if (checkedComponents.has(componentId)) {
      throw new Error("A component was checked more than once.");
    }

    checkedComponents.add(componentId);
  }

  if (!mainItemChecked) {
    throw new Error("Record the main item's return condition.");
  }

  if (checkedComponents.size !== expectedComponents.size) {
    throw new Error("Check every component from the pickup record.");
  }
}