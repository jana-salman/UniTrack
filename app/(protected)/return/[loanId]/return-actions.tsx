"use client";

import { useState } from "react";

import type { ReturnOutcome } from "@/lib/returns/equipment-port";
import type {
  ConfirmReturnInput,
  PickupCondition,
} from "@/lib/returns/types";
import ReturnForm from "./return-form";

interface ReturnActionsProps {
  loanId: string;
  pickupConditions: PickupCondition[];
}

export default function ReturnActions({
  loanId,
  pickupConditions,
}: ReturnActionsProps) {
  const [result, setResult] = useState<ReturnOutcome | null>(null);
  const [blocked, setBlocked] = useState(false);

  async function handleConfirm(input: ConfirmReturnInput) {
    if (blocked || result) {
      throw new Error("Reload the loan before continuing.");
    }

    let response: Response;

    try {
      response = await fetch(
        `/api/returns/${encodeURIComponent(loanId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
    } catch {
      setBlocked(true);

      throw new Error(
        "The connection was interrupted. Reload and check the loan before retrying.",
      );
    }

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      if (response.status >= 500) {
        setBlocked(true);
      }

      throw new Error(
        typeof body?.error === "string"
          ? body.error
          : "Unable to confirm the return.",
      );
    }

    if (
      body?.loanId !== loanId ||
      typeof body.returnedAt !== "string" ||
      !["available", "reserved", "inspection_required"].includes(
        body.status,
      ) ||
      typeof body.isLate !== "boolean"
    ) {
      setBlocked(true);

      throw new Error(
        "The response could not be verified. Reload and check the loan.",
      );
    }

    setResult(body as ReturnOutcome);
  }

  if (result) {
    const statusLabels = {
      available: "Available",
      reserved: "Reserved",
      inspection_required: "Inspection Required",
    };

    return (
      <section
        role="status"
        className="rounded-xl border border-green-300 bg-white p-5"
      >
        <h2 className="text-xl font-semibold text-slate-950">
          Return saved
        </h2>

        <p className="mt-2 text-slate-700">
          Equipment status: {statusLabels[result.status]}
        </p>

        <p className="mt-2 text-slate-700">
          {result.isLate ? "Recorded as late." : "Recorded as on time."}
        </p>
      </section>
    );
  }

  if (blocked) {
    return (
      <p role="alert" className="text-red-700">
        The return result needs verification. Reload the page and check
        the loan and equipment status before trying again.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <ReturnForm
        pickupConditions={pickupConditions}
        onConfirm={handleConfirm}
      />
    </div>
  );
}