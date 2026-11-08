"use client";

import { useState } from "react";
import type { FormEvent } from "react";

import { validateReturnChecklist } from "@/lib/returns/checklist";
import { validateReturnInput } from "@/lib/returns/validation";
import type {
  ConfirmReturnInput,
  PickupCondition,
} from "@/lib/returns/types";

interface ReturnFormProps {
  pickupConditions: PickupCondition[];
  onConfirm: (input: ConfirmReturnInput) => Promise<void>;
  equipmentName: string;
  componentNames: Record<string, string>;
}

export default function ReturnForm({
  pickupConditions,
  onConfirm,
  equipmentName,
  componentNames,
}: ReturnFormProps) {
  const componentIds = [
    ...new Set(
      pickupConditions
        .map((record) => record.kit_component_id)
        .filter((id): id is string => id !== null),
    ),
  ];

  const rows: (string | null)[] = [null, ...componentIds];

  const [conditions, setConditions] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [newDamage, setNewDamage] = useState<Record<string, boolean>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting) return;

    setError("");

    try {
        const input = validateReturnInput({
        conditions: rows.map((componentId) => {
          const key = componentId ?? "main";

          return {
            kitComponentId: componentId,
            conditionStatus: conditions[key] ?? "",
            notes: notes[key] ?? "",
            newDamage: newDamage[key] ?? false,
          };
        }),
      });

      validateReturnChecklist(pickupConditions, input.conditions);

      setSubmitting(true);
      await onConfirm(input);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to complete the return.",
      );
    } finally {
      setSubmitting(false);
    }
  }
  
  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <h2 className="text-xl font-semibold text-slate-950">
        Condition at return
      </h2>

      <fieldset
        disabled={submitting || pickupConditions.length === 0}
        className="space-y-5"
      >
        <legend className="sr-only">Return checks</legend>

        {rows.map((componentId, index) => {
          const key = componentId ?? "main";
          const label =
            componentId === null
              ? equipmentName
              : componentNames[componentId] ??
                `Kit component ${index}`;

          return (
            <div
              key={key}
              className="rounded-lg border border-slate-200 p-4"
            >
              <label
                htmlFor={`condition-${key}`}
                className="block font-semibold text-slate-950"
              >
                {label}
              </label>

              <select
                id={`condition-${key}`}
                required
                value={conditions[key] ?? ""}
                onChange={(event) =>
                  setConditions((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }))
                }
                className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-950"
              >
                <option value="">Choose return condition</option>
                <option value="good">Good</option>
                <option value="damaged">Damaged</option>
                <option value="missing">Missing</option>
                <option value="unknown">Needs attention</option>
              </select>

              <label className="mt-4 flex min-h-11 items-center gap-3 text-slate-700">
                <input
                  type="checkbox"
                  checked={newDamage[key] ?? false}
                  onChange={(event) =>
                    setNewDamage((current) => ({
                      ...current,
                      [key]: event.target.checked,
                    }))
                  }
                  className="h-5 w-5"
                />
                New or additional damage since pickup
              </label>

              <label
                htmlFor={`notes-${key}`}
                className="mt-4 block text-sm font-medium text-slate-700"
              >
                Notes for {label.toLowerCase()} (optional)
              </label>

              <textarea
                id={`notes-${key}`}
                rows={2}
                value={notes[key] ?? ""}
                onChange={(event) =>
                  setNotes((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }))
                }
                className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-950"
              />
            </div>
          );
        })}

        <button
          type="submit"
          className="min-h-11 rounded-lg bg-blue-700 px-5 py-3 font-semibold text-white disabled:opacity-50"
        >
          {submitting ? "Saving return..." : "Confirm return"}
        </button>
      </fieldset>

      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
