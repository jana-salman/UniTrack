"use client";

import { useEffect, useState } from "react";
import ReturnActions from "./return-actions";
import {
  isReturnDetails,
  type ConditionStatus,
  type ReturnDetails,
} from "@unitrack/contracts";

interface ReturnDetailsResponse extends ReturnDetails {
  borrower?: { name: string | null };
  partialData?: boolean;
  equipment: {
    name: string;
    components: {
      id: string;
      name: string;
    }[];
  };
}

function isReturnDetailsResponse(value: unknown): value is ReturnDetailsResponse {
  if (!isReturnDetails(value)) return false;
  const response = value as ReturnDetails & Record<string, unknown>;
  const equipment = response.equipment;
  if (!equipment || typeof equipment !== "object" || Array.isArray(equipment)) return false;
  const equipmentRecord = equipment as Record<string, unknown>;
  if (typeof equipmentRecord.name !== "string" || !Array.isArray(equipmentRecord.components)) return false;
  if (!equipmentRecord.components.every(component => {
    if (!component || typeof component !== "object" || Array.isArray(component)) return false;
    const row = component as Record<string, unknown>;
    return typeof row.id === "string" && typeof row.name === "string";
  })) return false;
  const borrower = response.borrower;
  if (borrower !== undefined) {
    if (!borrower || typeof borrower !== "object" || Array.isArray(borrower)) return false;
    const name = (borrower as Record<string, unknown>).name;
    if (name !== null && typeof name !== "string") return false;
  }
  return response.partialData === undefined || typeof response.partialData === "boolean";
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ReturnDetailsResponse };

const conditionLabels: Record<ConditionStatus, string> = {
  good: "Good",
  damaged: "Existing damage",
  missing: "Missing",
  unknown: "Needs attention",
};

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

export default function ReturnDetails({
  loanId,
}: {
  loanId: string;
}) {
  const [state, setState] = useState<LoadState>({
    status: "loading",
  });

  useEffect(() => {
    const controller = new AbortController();

    async function loadDetails() {
      try {
        const response = await fetch(
          `/api/returns/${encodeURIComponent(loanId)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          const errorBody = await response.json().catch(() => null);

          throw new Error(
            typeof errorBody?.error === "string"
              ? errorBody.error
              : "Unable to load return details.",
          );
        }

        const data: unknown = await response.json();
        if (!isReturnDetailsResponse(data)) {
          throw new Error("The return details response is invalid.");
        }

        if (!controller.signal.aborted) {
          setState({ status: "ready", data });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Unable to load return details.",
          });
        }
      }
    }

    void loadDetails();

    return () => controller.abort();
  }, [loanId]);

  if (state.status === "loading") {
    return <p role="status">Loading pickup record...</p>;
  }

  if (state.status === "error") {
    return (
      <p role="alert" className="text-red-700">
        {state.message}
      </p>
    );
  }

  const { loan, pickupConditions, equipment, borrower, partialData } = state.data;

  const componentNames = Object.fromEntries(
    equipment.components.map((component) => [
      component.id,
      component.name,
    ]),
  );

  return (
    <section className="max-w-3xl space-y-6">
      {partialData && <p role="status">Some equipment labels or the borrower name are unavailable.</p>}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-xl font-semibold text-slate-950">
          Loan details
        </h2>
        <p className="mt-2 font-medium text-slate-700">
          {equipment.name}
        </p>

        <dl className="mt-4 space-y-3 text-slate-700">
          {borrower?.name && <div><dt className="font-semibold">Borrower</dt><dd>{borrower.name}</dd></div>}
          <div>
            <dt className="font-semibold">Picked up</dt>
            <dd>{formatDate(loan.borrowed_at)}</dd>
          </div>

          <div>
            <dt className="font-semibold">Due</dt>
            <dd>{formatDate(loan.due_date)}</dd>
          </div>

          {loan.returned_at && (
            <div>
              <dt className="font-semibold">Already returned</dt>
              <dd>{formatDate(loan.returned_at)}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-xl font-semibold text-slate-950">
          Condition at pickup
        </h2>

        {pickupConditions.length === 0 ? (
          <p role="alert" className="mt-4 text-red-700">
            The pickup condition records are missing.
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {pickupConditions.map((record, index) => (
              <li
                key={record.id}
                className="rounded-lg border border-slate-200 p-4"
              >
                <h3 className="font-semibold text-slate-950">
                  {record.kit_component_id === null
                  ? equipment.name
                  : componentNames[record.kit_component_id] ??
                    `Kit component ${index + 1}`}
                </h3>

                <p className="mt-1 text-slate-700">
                  {conditionLabels[record.condition_status]}
                </p>

                {record.notes && (
                  <p className="mt-2 whitespace-pre-wrap text-slate-600">
                    {record.notes}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {loan.returned_at === null && pickupConditions.length > 0 && (
        <ReturnActions
          key={loan.id}
          loanId={loan.id}
          pickupConditions={pickupConditions}
          equipmentName={equipment.name}
          componentNames={componentNames}
        />
      )}
    </section>
  );
}
