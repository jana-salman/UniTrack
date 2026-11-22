"use client";

import { useEffect, useState } from "react";
import { HANDOVER_CONDITION_LABELS, isHandoverOutcome, type HandoverOutcome, type InterruptedHandover } from "@unitrack/contracts";
import StatusBadge from "@/components/StatusBadge";
import { isHandoverView, isInterruptedList, statusLabel, type HandoverView } from "@/lib/handover-view";
import HandoverForm from "./handover-form";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: HandoverView };

const PENDING_TEXT: Record<string, string> = {
  planned: "A confirmed handover was interrupted before Equipment confirmed the checkout.",
  applied: "Equipment shows this item checked out, but the handover was not finished.",
  compensating: "An interrupted handover is being undone, but the undo was not confirmed.",
};

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}
async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  const message = (body as { error?: unknown } | null)?.error;
  return typeof message === "string" ? message : fallback;
}

export default function HandoverDetails({ reservationId }: { reservationId: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [outcome, setOutcome] = useState<HandoverOutcome | null>(null);
  const [interrupted, setInterrupted] = useState<InterruptedHandover[]>([]);
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  // Message from the last unsuccessful submission, kept when an unresolved
  // operation replaces the form after the page re-reads Loans state.
  const [lastAttempt, setLastAttempt] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/handover/${encodeURIComponent(reservationId)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(await errorMessage(response, "Unable to load the reservation."));
        const body: unknown = await response.json();
        if (!isHandoverView(body)) throw new Error("The reservation details response is invalid.");
        if (!controller.signal.aborted) setState({ status: "ready", data: body });
      } catch (error) {
        if (!controller.signal.aborted) setState({ status: "error", message: error instanceof Error ? error.message : "Unable to load the reservation." });
      }
      // Unfinished handovers in this lab, so none depends on a browser staying open.
      try {
        const response = await fetch("/api/handover", { cache: "no-store", signal: controller.signal });
        const body: unknown = response.ok ? await response.json() : [];
        if (!controller.signal.aborted) setInterrupted(isInterruptedList(body) ? body : []);
      } catch { /* The list is a convenience; the reservation page still works. */ }
    }
    void load();
    return () => controller.abort();
  }, [reservationId, reload]);

  async function finishInterrupted() {
    if (recovering) return;
    setRecovering(true); setRecoveryError("");
    try {
      const response = await fetch(`/api/handover/${encodeURIComponent(reservationId)}/recover`, { method: "POST" });
      if (!response.ok) { setRecoveryError(await errorMessage(response, "Unable to finish the interrupted handover.")); return; }
      const body: unknown = await response.json();
      if (isHandoverOutcome(body)) setOutcome(body);
    } catch {
      setRecoveryError("The connection was interrupted. Try Finish interrupted handover again.");
    } finally {
      setRecovering(false); setReload(value => value + 1);
    }
  }

  if (state.status === "loading") return <p role="status">Loading reservation...</p>;
  if (state.status === "error") return <p role="alert" className="text-red-700">{state.message}</p>;

  const { reservation, handover, equipment, components, borrower, partialData, pending, checklistVersion } = state.data;
  const equipmentName = equipment?.name ?? "Equipment name unavailable";
  const componentNames = Object.fromEntries((components ?? []).map(component => [component.id, component.name]));
  // Loans only reports a completed handover after Equipment confirmed checkout.
  const currentStatus = equipment ? statusLabel(equipment.status) : outcome ? statusLabel(outcome.status) : "Status unavailable";
  const others = interrupted.filter(row => row.reservationId.toLowerCase() !== reservation.id.toLowerCase());

  return (
    <section className="max-w-3xl space-y-6">
      {partialData && <p role="status">Some equipment details or the borrower identity are unavailable.</p>}

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-xl font-semibold text-slate-950">Reservation</h2>
        <p className="mt-2 font-medium text-slate-700">
          {equipmentName}{equipment?.assetCode ? ` (${equipment.assetCode})` : ""}
        </p>
        <dl className="mt-4 space-y-3 text-slate-700">
          <div><dt className="font-semibold">Status</dt><dd><StatusBadge status={currentStatus} /></dd></div>
          <div>
            <dt className="font-semibold">Borrower</dt>
            <dd>{borrower.name ?? "Borrower name unavailable"}</dd>
            <dd className="text-sm" data-testid="borrower-identity">
              {borrower.identity === "verified" ? "Borrower verified: active student in your lab, matching this reservation. Check their university ID card in person."
                : borrower.identity === "not_verified" ? "Borrower not verified: not an active student in your lab for this reservation."
                : "Borrower cannot be checked right now."}
            </dd>
          </div>
          <div><dt className="font-semibold">Pickup from</dt><dd>{formatDate(reservation.startAt)}</dd></div>
          <div><dt className="font-semibold">Due</dt><dd>{formatDate(handover?.dueDate ?? reservation.endAt)}</dd></div>
        </dl>
      </div>

      {handover ? (
        <section role="status" aria-labelledby="handover-complete" className="rounded-xl border border-green-300 bg-white p-5">
          <h2 id="handover-complete" className="text-xl font-semibold text-slate-950">Handover complete</h2>
          <p className="mt-2 text-slate-700">Equipment status: {currentStatus}</p>
          <p className="mt-1 text-slate-700">Borrower: {borrower.name ?? "Borrower name unavailable"}</p>
          <p className="mt-1 text-slate-700">Due: {formatDate(handover.dueDate)}</p>
          {handover.universityIdVerifiedAt && <p className="mt-1 text-slate-700">University ID checked in person: {formatDate(handover.universityIdVerifiedAt)}</p>}
          {handover.studentConfirmedAt && <p className="mt-1 text-slate-700">Student confirmed: {formatDate(handover.studentConfirmedAt)}</p>}
          <h3 className="mt-4 font-semibold text-slate-950">Condition at pickup</h3>
          <ul className="mt-2 space-y-2">
            {handover.pickupConditions.map(record => (
              <li key={record.id} className="rounded-lg border border-slate-200 p-3">
                <p className="font-semibold">{record.kitComponentId === null ? `${equipmentName} (main item)` : componentNames[record.kitComponentId] ?? "Component label unavailable"}</p>
                <p>{HANDOVER_CONDITION_LABELS[record.conditionStatus]}</p>
                {record.notes && <p className="whitespace-pre-wrap text-slate-600">{record.notes}</p>}
              </li>
            ))}
          </ul>
        </section>
      ) : pending ? (
        <section aria-labelledby="handover-interrupted" className="rounded-xl border border-amber-300 bg-amber-50 p-5">
          <h2 id="handover-interrupted" className="text-xl font-semibold text-amber-950">Handover not finished — outcome uncertain</h2>
          <p className="mt-2 text-amber-900">{PENDING_TEXT[pending.state] ?? "A handover for this reservation is unfinished."} Started {formatDate(pending.startedAt)}.</p>
          {lastAttempt && <p role="alert" className="mt-2 text-red-700">{lastAttempt}</p>}
          <p className="mt-1 text-sm text-amber-900">A new handover cannot be started for this reservation until this one is finished or undone. The saved checklist, university ID check and student&apos;s confirmation are used; nothing needs to be re-entered.</p>
          {pending.recoverableByYou ? (
            <button type="button" onClick={() => void finishInterrupted()} disabled={recovering}
              className="mt-3 min-h-11 rounded-lg bg-amber-700 px-5 py-3 font-semibold text-white disabled:opacity-50">
              {recovering ? "Finishing..." : "Finish interrupted handover"}
            </button>
          ) : (
            <p role="status" className="mt-3 text-amber-900">Only the assistant who started this handover can finish or undo it. Ask them, or ask a lab manager to reconcile.</p>
          )}
          {recoveryError && <p role="alert" className="mt-2 text-red-700">{recoveryError}</p>}
        </section>
      ) : reservation.status !== "confirmed" ? (
        <p role="alert" className="text-red-700">Only confirmed reservations can be handed over.</p>
      ) : equipment === null || components === null || checklistVersion === null ? (
        <p role="alert" className="text-red-700">The equipment checklist is unavailable, so the handover cannot continue. Reload to try again.</p>
      ) : borrower.identity !== "verified" ? (
        <p role="alert" className="text-red-700">
          {borrower.identity === "unavailable"
            ? "The borrower's identity cannot be checked right now, so the handover cannot continue. Reload to try again."
            : "The borrower must be an active student in this lab, matching the reservation."}
        </p>
      ) : (
        <HandoverForm
          reservationId={reservation.id}
          equipmentName={equipmentName}
          components={components}
          checklistVersion={checklistVersion}
          borrowerName={borrower.name}
          onComplete={result => { setOutcome(result); setReload(value => value + 1); }}
          onSettled={message => { setLastAttempt(message); setReload(value => value + 1); }}
        />
      )}

      {others.length > 0 && (
        <section aria-labelledby="lab-interrupted" className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 id="lab-interrupted" className="text-lg font-semibold text-slate-950">Unfinished handovers in your lab</h2>
          <ul className="mt-2 space-y-1">
            {others.map(row => (
              <li key={row.reservationId}>
                <a className="text-blue-700 underline" href={`/handover/${encodeURIComponent(row.reservationId)}`}>
                  Reservation {row.reservationId.slice(0, 8)}… started {formatDate(row.startedAt)}
                </a>{row.recoverableByYou ? "" : " (started by another assistant)"}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
