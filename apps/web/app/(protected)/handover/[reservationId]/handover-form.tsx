"use client";

import { useState, type FormEvent } from "react";
import {
  HANDOVER_CONDITION_LABELS,
  HANDOVER_NOTES_MAX_LENGTH,
  HANDOVER_NOTE_REQUIRED_MESSAGE,
  handoverNoteRequired,
  hasRequiredHandoverNote,
  isHandoverOutcome,
  type ConditionStatus,
  type ConfirmHandoverInput,
  type HandoverOutcome,
} from "@unitrack/contracts";
import { classifyHandoverFailure } from "@/lib/handover-view";

interface HandoverFormProps {
  reservationId: string;
  equipmentName: string;
  /** Active kit components from Equipment; empty for non-kit equipment. */
  components: { id: string; name: string; required: boolean }[];
  /** Version of the component list shown; Loans rejects a stale checklist. */
  checklistVersion: string;
  borrowerName: string | null;
  onComplete: (outcome: HandoverOutcome) => void;
  /**
   * Called after every unsuccessful attempt with the message shown, so the page
   * re-reads Loans state (an unresolved operation then replaces this form).
   */
  onSettled?: (message: string) => void;
}

const CONDITIONS = Object.keys(HANDOVER_CONDITION_LABELS) as ConditionStatus[];

export default function HandoverForm({ reservationId, equipmentName, components, checklistVersion, borrowerName, onComplete, onSettled }: HandoverFormProps) {
  // The main item (kit case or non-kit item) always gets its OWN row and
  // condition; kit components follow, rendered from Equipment's actual list.
  const rows = [
    { key: "main", id: null as string | null, label: components.length ? `${equipmentName} (main item)` : equipmentName, required: true },
    ...components.map(component => ({ key: component.id, id: component.id as string | null, label: component.name, required: component.required })),
  ];
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [conditions, setConditions] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [studentConfirmed, setStudentConfirmed] = useState(false);
  // PO decision (JS): the assistant checks the university ID card in person.
  // Separate from the student's confirmation; nothing about the card is stored.
  const [idVerified, setIdVerified] = useState(false);
  // Shown after the record changes under an existing confirmation.
  const [confirmationCleared, setConfirmationCleared] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // After an UNCERTAIN result, only the SAME information may be resent; a fresh
  // submission is blocked until the outcome is resolved.
  const [retryPayload, setRetryPayload] = useState<ConfirmHandoverInput | null>(null);
  const student = borrowerName ?? "The student";
  // What the student is confirming (PO decision A1): every row recorded as
  // missing, with its note, plus any other recorded problem.
  const recorded = rows.map(row => ({ ...row, condition: conditions[row.key] as ConditionStatus | undefined, note: (notes[row.key] ?? "").trim() }));
  const missingRows = recorded.filter(row => row.condition === "missing");
  const otherProblems = recorded.filter(row => row.condition === "damaged" || row.condition === "unknown");

  // Missing component / Existing damage rows need a note (Loans enforces it too).
  const noteRequired = (key: string) => handoverNoteRequired(conditions[key]);
  const noteMissing = (key: string) => !hasRequiredHandoverNote({ conditionStatus: conditions[key], notes: notes[key] });

  /** Any change to the checklist after confirmation clears it (must reconfirm). */
  function edit(apply: () => void) {
    apply();
    if (studentConfirmed) { setStudentConfirmed(false); setConfirmationCleared(true); }
  }

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
        onSettled?.("The connection was interrupted. Retry the same handover information.");
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const { error: message, code } = (body ?? {}) as { error?: unknown; code?: unknown };
        const kind = classifyHandoverFailure(response.status, code);
        setRetryPayload(kind === "uncertain" ? payload : null);
        const text = typeof message === "string" ? message : "Unable to complete the handover.";
        setError(text);
        onSettled?.(text);
        return;
      }
      if (!isHandoverOutcome(body) || body.reservationId.toLowerCase() !== reservationId.toLowerCase()) {
        setRetryPayload(payload);
        setError("The response could not be verified. Retry the same handover information.");
        onSettled?.("The response could not be verified. Retry the same handover information.");
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
    // Same shared rule Loans enforces: omitted, empty or whitespace-only notes fail.
    if (rows.some(row => !hasRequiredHandoverNote({ conditionStatus: conditions[row.key], notes: notes[row.key] }))) return setError(HANDOVER_NOTE_REQUIRED_MESSAGE);
    if (!studentConfirmed) return setError("The student must confirm the handover before it can be completed.");
    if (!idVerified) return setError("Check the student's university ID card in person and tick the ID check before completing the handover.");
    await send({
      universityIdVerified: true,
      studentConfirmed: true,
      checklistVersion,
      acknowledgedMissing: missingRows.map(row => row.id),
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
          {components.length ? `Kit checklist (main item + ${components.length} components)` : "Equipment check"}
        </legend>

        {rows.map(row => (
          <div key={row.key} className="rounded-lg border border-slate-200 bg-white p-4" data-testid="handover-row">
            <label className="flex min-h-11 items-center gap-3 font-semibold text-slate-950">
              <input
                type="checkbox"
                name={`checked-${row.key}`}
                checked={checked[row.key] ?? false}
                onChange={event => { const value = event.target.checked; edit(() => setChecked(current => ({ ...current, [row.key]: value }))); }}
                className="h-5 w-5"
              />
              {row.label}{row.id !== null && !row.required ? " (optional)" : ""}
            </label>
            <p className="text-sm text-slate-500">Tick after checking it, including when it is missing.</p>

            <label htmlFor={`condition-${row.key}`} className="mt-3 block text-sm font-medium text-slate-700">Condition</label>
            <select
              id={`condition-${row.key}`}
              value={conditions[row.key] ?? ""}
              onChange={event => { const value = event.target.value; edit(() => setConditions(current => ({ ...current, [row.key]: value }))); }}
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-950"
            >
              <option value="">Choose condition</option>
              {CONDITIONS.map(value => <option key={value} value={value}>{HANDOVER_CONDITION_LABELS[value]}</option>)}
            </select>

            <label htmlFor={`notes-${row.key}`} className="mt-3 block text-sm font-medium text-slate-700">
              {noteRequired(row.key) ? "Notes (required)" : "Notes (optional)"}
            </label>
            <textarea
              id={`notes-${row.key}`}
              rows={2}
              maxLength={HANDOVER_NOTES_MAX_LENGTH}
              value={notes[row.key] ?? ""}
              aria-required={noteRequired(row.key)}
              aria-invalid={noteMissing(row.key) || undefined}
              aria-describedby={noteMissing(row.key) ? `notes-hint-${row.key}` : undefined}
              onChange={event => { const value = event.target.value; edit(() => setNotes(current => ({ ...current, [row.key]: value }))); }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-950"
            />
            {noteMissing(row.key) && (
              <p id={`notes-hint-${row.key}`} className="mt-1 text-sm text-red-700" data-testid="note-required">
                Describe what is {conditions[row.key] === "missing" ? "missing" : "damaged"}.
              </p>
            )}
          </div>
        ))}

        <div className="rounded-lg border border-slate-300 bg-white p-4">
          <h2 className="font-semibold text-slate-950">University ID check (lab assistant)</h2>
          <p className="mt-1 text-sm text-slate-700">Do not type, photograph or upload the card. Only that you checked it is recorded.</p>
          <label className="mt-3 flex min-h-11 items-start gap-3 text-slate-900">
            <input
              type="checkbox"
              name="university-id-verified"
              checked={idVerified}
              onChange={event => setIdVerified(event.target.checked)}
              className="mt-0.5 h-5 w-5"
            />
            I checked {borrowerName ? `${borrowerName}'s` : "the student's"} university ID card in person and it matches the borrower of this reservation.
          </label>
        </div>

        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <h2 className="font-semibold text-slate-950">Student confirmation</h2>
          <p className="mt-1 text-sm text-slate-700">Hand this screen to {borrowerName ?? "the student"} to read the checklist and confirm.</p>
          {missingRows.length > 0 && (
            <div className="mt-3 rounded-md border border-red-300 bg-white p-3" data-testid="confirmation-missing">
              <p className="font-semibold text-red-800">Missing — not being handed over:</p>
              <ul className="mt-1 list-disc pl-5 text-slate-900">
                {missingRows.map(row => <li key={row.key}>{row.label}{row.note ? ` — "${row.note}"` : ""}</li>)}
              </ul>
            </div>
          )}
          {otherProblems.length > 0 && (
            <div className="mt-3 rounded-md border border-amber-300 bg-white p-3" data-testid="confirmation-problems">
              <p className="font-semibold text-amber-900">Other recorded conditions:</p>
              <ul className="mt-1 list-disc pl-5 text-slate-900">
                {otherProblems.map(row => <li key={row.key}>{row.label}: {HANDOVER_CONDITION_LABELS[row.condition!]}{row.note ? ` — "${row.note}"` : ""}</li>)}
              </ul>
            </div>
          )}
          {confirmationCleared && !studentConfirmed && (
            <p role="status" className="mt-3 text-sm font-semibold text-red-800">The checklist changed after the student confirmed. The student must confirm again.</p>
          )}
          <label className="mt-3 flex min-h-11 items-start gap-3 text-slate-900">
            <input
              type="checkbox"
              name="student-confirmed"
              checked={studentConfirmed}
              onChange={event => { setStudentConfirmed(event.target.checked); if (event.target.checked) setConfirmationCleared(false); }}
              className="mt-0.5 h-5 w-5"
            />
            {student} confirms receiving {equipmentName} in the condition recorded above
            {missingRows.length > 0 ? `, including the ${missingRows.length} missing item${missingRows.length === 1 ? "" : "s"} listed here` : ""}.
          </label>
        </div>

        <button type="submit" className="min-h-11 rounded-lg bg-blue-700 px-5 py-3 font-semibold text-white disabled:opacity-50">
          {submitting ? "Completing handover..." : "Complete handover"}
        </button>
      </fieldset>

      {retryPayload && (
        <section role="status" aria-labelledby="handover-uncertain" className="rounded-lg border border-amber-300 bg-amber-50 p-4" data-testid="handover-uncertain">
          <h2 id="handover-uncertain" className="font-semibold text-amber-950">Outcome not confirmed</h2>
          <p className="mt-1 text-amber-900">
            The handover may or may not have been recorded. Do not start a new handover or give out other equipment for this reservation.
            Retry the same handover; it resumes the same attempt and never checks the item out twice.
          </p>
          <button
            type="button"
            onClick={() => void send(retryPayload)}
            disabled={submitting}
            className="mt-3 min-h-11 rounded-lg border border-blue-700 bg-white px-5 py-3 font-semibold text-blue-700 disabled:opacity-50"
          >
            Retry the same handover
          </button>
        </section>
      )}

      {error && <p role="alert" className="text-red-700">{error}</p>}
    </form>
  );
}
