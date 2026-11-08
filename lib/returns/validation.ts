import type {
  ConditionStatus,
  ConfirmReturnInput,
  ReturnConditionInput,
} from "./types";

const allowedConditions: readonly ConditionStatus[] = [
  "good",
  "damaged",
  "missing",
  "unknown",
];

export function validateReturnInput(value: unknown): ConfirmReturnInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid return information.");
  }

  const conditions = (value as Record<string, unknown>).conditions;

  if (!Array.isArray(conditions) || conditions.length === 0) {
    throw new Error("Record the return condition before confirming.");
  }

  const seen = new Set<string | null>();

  const validated = conditions.map((entry): ReturnConditionInput => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("Invalid condition record.");
    }

    const record = entry as Record<string, unknown>;
    const componentId = record.kitComponentId;
    const status = record.conditionStatus;
    const notes = record.notes;

    if (
      componentId !== null &&
      (typeof componentId !== "string" || componentId.trim() === "")
    ) {
      throw new Error("Invalid kit component ID.");
    }

    if (seen.has(componentId)) {
      throw new Error("Each item or component must be checked only once.");
    }

    seen.add(componentId);

    if (
      typeof status !== "string" ||
      !allowedConditions.includes(status as ConditionStatus)
    ) {
      throw new Error("Choose a valid condition.");
    }

    if (notes !== undefined && typeof notes !== "string") {
      throw new Error("Condition notes must be text.");
    }

    return {
      kitComponentId: componentId,
      conditionStatus: status as ConditionStatus,
      notes: typeof notes === "string" ? notes.trim() : undefined,
    };
  });

  return { conditions: validated };
}