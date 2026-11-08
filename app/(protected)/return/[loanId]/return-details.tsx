"use client";

import { useEffect, useState } from "react";
import ReturnActions from "./return-actions";
import type {
  ConditionStatus,
  PickupCondition,
  ReturnLoan,
} from "@/lib/returns/types";

type LoanResponse = Omit<
  ReturnLoan,
  "borrowed_at" | "due_date" | "returned_at"
> & {
  borrowed_at: string;
  due_date: string;
  returned_at: string | null;
};

interface ReturnDetailsResponse {
  loan: LoanResponse;
  pickupConditions: PickupCondition[];
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

        const data =
          (await response.json()) as ReturnDetailsResponse;

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

  const { loan, pickupConditions } = state.data;

  return (
    <section className="max-w-3xl space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-xl font-semibold text-slate-950">
          Loan details
        </h2>

        <dl className="mt-4 space-y-3 text-slate-700">
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
                    ? "Main equipment item"
                    : `Kit component ${index + 1}`}
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
        />
      )}
    </section>
  );
}