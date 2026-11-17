"use client";

import { useEffect, useState } from "react";
import { HANDOVER_CONDITION_LABELS, type HandoverOutcome } from "@unitrack/contracts";
import StatusBadge from "@/components/StatusBadge";
import { isHandoverView, statusLabel, type HandoverView } from "@/lib/handover-view";
import HandoverForm from "./handover-form";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: HandoverView };

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

export default function HandoverDetails({ reservationId }: { reservationId: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [outcome, setOutcome] = useState<HandoverOutcome | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/handover/${encodeURIComponent(reservationId)}`, { cache: "no-store", signal: controller.signal });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message = (body as { error?: unknown } | null)?.error;
          throw new Error(typeof message === "string" ? message : "Unable to load the reservation.");
        }
        if (!isHandoverView(body)) throw new Error("The reservation details response is invalid.");
        if (!controller.signal.aborted) setState({ status: "ready", data: body });
      } catch (error) {
        if (!controller.signal.aborted) setState({ status: "error", message: error instanceof Error ? error.message : "Unable to load the reservation." });
      }
    }
    void load();
    return () => controller.abort();
  }, [reservationId, reload]);

  if (state.status === "loading") return <p role="status">Loading reservation...</p>;
  if (state.status === "error") return <p role="alert" className="text-red-700">{state.message}</p>;

  const { reservation, handover, equipment, components, borrower, partialData, pendingOperation } = state.data;
  const equipmentName = equipment?.name ?? "Equipment name unavailable";
  const componentNames = Object.fromEntries((components ?? []).map(component => [component.id, component.name]));
  // Loans only reports a completed handover after Equipment confirmed checkout.
  const currentStatus = equipment ? statusLabel(equipment.status) : outcome ? statusLabel(outcome.status) : "Status unavailable";

  return (
    <section className="max-w-3xl space-y-6">
      {partialData && <p role="status">Some equipment details or the borrower name are unavailable.</p>}

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-xl font-semibold text-slate-950">Reservation</h2>
        <p className="mt-2 font-medium text-slate-700">
          {equipmentName}{equipment?.assetCode ? ` (${equipment.assetCode})` : ""}
        </p>
        <dl className="mt-4 space-y-3 text-slate-700">
          <div><dt className="font-semibold">Status</dt><dd><StatusBadge status={currentStatus} /></dd></div>
          <div><dt className="font-semibold">Borrower</dt><dd>{borrower.name ?? "Borrower name unavailable"}</dd></div>
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
          {handover.studentConfirmedAt && <p className="mt-1 text-slate-700">Student confirmed: {formatDate(handover.studentConfirmedAt)}</p>}
          <h3 className="mt-4 font-semibold text-slate-950">Condition at pickup</h3>
          <ul className="mt-2 space-y-2">
            {handover.pickupConditions.map(record => (
              <li key={record.id} className="rounded-lg border border-slate-200 p-3">
                <p className="font-semibold">{record.kitComponentId === null ? equipmentName : componentNames[record.kitComponentId] ?? "Component label unavailable"}</p>
                <p>{HANDOVER_CONDITION_LABELS[record.conditionStatus]}</p>
                {record.notes && <p className="whitespace-pre-wrap text-slate-600">{record.notes}</p>}
              </li>
            ))}
          </ul>
        </section>
      ) : reservation.status !== "confirmed" ? (
        <p role="alert" className="text-red-700">Only confirmed reservations can be handed over.</p>
      ) : equipment === null || components === null ? (
        <p role="alert" className="text-red-700">The equipment checklist is unavailable, so the handover cannot continue. Reload to try again.</p>
      ) : (
        <>
          {pendingOperation && (
            <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
              A previous confirmed attempt did not finish. Enter exactly the same checklist and notes to finish it, or ask staff to reconcile it.
            </p>
          )}
          <HandoverForm
            reservationId={reservation.id}
            equipmentName={equipmentName}
            components={components}
            borrowerName={borrower.name}
            onComplete={result => { setOutcome(result); setReload(value => value + 1); }}
          />
        </>
      )}
    </section>
  );
}
