"use client";

import { useState, type FormEvent } from "react";
import {
  HANDOVER_CONDITION_LABELS,
  HANDOVER_NOTES_MAX_LENGTH,
  isHandoverOutcome,
  type ConditionStatus,
  type ConfirmHandoverInput,
  type HandoverOutcome,
} from "@unitrack/contracts";

interface HandoverFormProps {
  reservationId: string;
  equipmentName: string;
  /** Active kit components from Equipment; empty for non-kit equipment. */
  components: { id: string; name: string; required: boolean }[];
  borrowerName: string | null;
  onComplete: (outcome: HandoverOutcome) => void;
}

const CONDITIONS = Object.keys(HANDOVER_CONDITION_LABELS) as ConditionStatus[];

export default function HandoverForm({ reservationId, equipmentName, components, borrowerName, onComplete }: HandoverFormProps) {
  // Rendered dynamically from Equipment's component list; never a fixed count.
  const rows = components.length
    ? components.map(component => ({ key: component.id, id: component.id as string | null, label: component.name, required: component.required }))
    : [{ key: "main", id: null as string | null, label: equipmentName, required: true }];
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [conditions, setConditions] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [studentConfirmed, setStudentConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // After an uncertain result, only the SAME information may be resent.
  const [retryPayload, setRetryPayload] = useState<ConfirmHandoverInput | null>(null);
  const student = borrowerName ?? "The student";

  async function send(payload: ConfirmHandoverInput) {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      let response: Response;
      try {
        response = await fetch(`/api/handover/${encodeURIComponent(reservationId)}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
      } catch {
        setRetryPayload(payload);
        setError("The connection was interrupted. Retry the same handover information.");
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status >= 500) setRetryPayload(payload);
        const message = (body as { error?: unknown } | null)?.error;
        setError(typeof message === "string" ? message : "Unable to complete the handover.");
        return;
      }
      if (!isHandoverOutcome(body) || body.reservationId.toLowerCase() !== reservationId.toLowerCase()) {
        setRetryPayload(payload);
        setError("The response could not be verified. Retry the same handover information.");
        return;
      }
      onComplete(body);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || retryPayload) return;
    // Form feedback only; Loans validates everything again on the server.
    if (rows.some(row => !checked[row.key])) return setError("Tick every row after checking it.");
    if (rows.some(row => !CONDITIONS.includes(conditions[row.key] as ConditionStatus))) return setError("Choose a condition for every row.");
    if (!studentConfirmed) return setError("The student must confirm the handover before it can be completed.");
    await send({
      studentConfirmed: true,
      conditions: rows.map(row => ({
        kitComponentId: row.id, checked: true,
        conditionStatus: conditions[row.key] as ConditionStatus,
        notes: (notes[row.key] ?? "").trim(),
      })),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <fieldset disabled={submitting || retryPayload !== null} className="space-y-5">
        <legend className="text-xl font-semibold text-slate-950">
          {components.length ? `Kit checklist (${components.length} components)` : "Equipment check"}
        </legend>

        {rows.map(row => (
          <div key={row.key} className="rounded-lg border border-slate-200 bg-white p-4" data-testid="handover-row">
            <label className="flex min-h-11 items-center gap-3 font-semibold text-slate-950">
              <input
                type="checkbox"
                name={`checked-${row.key}`}
                checked={checked[row.key] ?? false}
                onChange={event => setChecked(current => ({ ...current, [row.key]: event.target.checked }))}
                className="h-5 w-5"
              />
              {row.label}{components.length > 0 && !row.required ? " (optional)" : ""}
            </label>
            <p className="text-sm text-slate-500">Tick after checking it, including when it is missing.</p>

            <label htmlFor={`condition-${row.key}`} className="mt-3 block text-sm font-medium text-slate-700">Condition</label>
            <select
              id={`condition-${row.key}`}
              value={conditions[row.key] ?? ""}
              onChange={event => setConditions(current => ({ ...current, [row.key]: event.target.value }))}
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-950"
            >
              <option value="">Choose condition</option>
              {CONDITIONS.map(value => <option key={value} value={value}>{HANDOVER_CONDITION_LABELS[value]}</option>)}
            </select>

            <label htmlFor={`notes-${row.key}`} className="mt-3 block text-sm font-medium text-slate-700">Notes (optional)</label>
            <textarea
              id={`notes-${row.key}`}
              rows={2}
              maxLength={HANDOVER_NOTES_MAX_LENGTH}
              value={notes[row.key] ?? ""}
              onChange={event => setNotes(current => ({ ...current, [row.key]: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-950"
            />
          </div>
        ))}

        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <h2 className="font-semibold text-slate-950">Student confirmation</h2>
          <p className="mt-1 text-sm text-slate-700">Hand this screen to {borrowerName ?? "the student"} to read the checklist and confirm.</p>
          <label className="mt-3 flex min-h-11 items-start gap-3 text-slate-900">
            <input
              type="checkbox"
              name="student-confirmed"
              checked={studentConfirmed}
              onChange={event => setStudentConfirmed(event.target.checked)}
              className="mt-0.5 h-5 w-5"
            />
            {student} confirms receiving {equipmentName} in the condition recorded above.
          </label>
        </div>

        <button type="submit" className="min-h-11 rounded-lg bg-blue-700 px-5 py-3 font-semibold text-white disabled:opacity-50">
          {submitting ? "Completing handover..." : "Complete handover"}
        </button>
      </fieldset>

      {retryPayload && (
        <button
          type="button"
          onClick={() => void send(retryPayload)}
          disabled={submitting}
          className="min-h-11 rounded-lg border border-blue-700 px-5 py-3 font-semibold text-blue-700 disabled:opacity-50"
        >
          Retry the same handover
        </button>
      )}

      {error && <p role="alert" className="text-red-700">{error}</p>}
    </form>
  );
}
