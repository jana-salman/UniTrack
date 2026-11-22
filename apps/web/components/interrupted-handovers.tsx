"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { InterruptedHandover } from "@unitrack/contracts";
import { isInterruptedList } from "@/lib/handover-view";

type InterruptedHandoversProps = {
  itemId?: string;
  excludeReservationId?: string;
  refreshKey?: number;
};

export function InterruptedHandovers({ itemId, excludeReservationId, refreshKey }: InterruptedHandoversProps) {
  const [records, setRecords] = useState<InterruptedHandover[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch("/api/handover", { cache: "no-store", signal: controller.signal });
        const data: unknown = response.ok ? await response.json() : [];
        if (!controller.signal.aborted) setRecords(isInterruptedList(data) ? data : []);
      } catch {
        if (!controller.signal.aborted) setRecords([]);
      }
    }

    void load();
    return () => controller.abort();
  }, [refreshKey]);

  const visibleRecords = records.filter((record) =>
    (!itemId || record.itemId.toLowerCase() === itemId.toLowerCase()) &&
    record.reservationId.toLowerCase() !== excludeReservationId?.toLowerCase(),
  );

  if (visibleRecords.length === 0) return null;

  const Heading = itemId ? "h3" : "h2";
  return (
    <section aria-label="Unfinished handovers" className="panel p-4">
      <Heading className="text-base font-semibold">
        {itemId ? "Unfinished handovers for this equipment" : "Unfinished handovers in your lab"}
      </Heading>
      <ul className="mt-2 space-y-2">
        {visibleRecords.map((record) => (
          <li key={record.reservationId}>
            <Link className="font-medium text-aub-700 underline" href={`/handover/${encodeURIComponent(record.reservationId)}`}>
              Reservation {record.reservationId.slice(0, 8)}… started{" "}
              <time dateTime={record.startedAt}>{new Date(record.startedAt).toLocaleString()}</time>
            </Link>
            {!record.recoverableByYou && " (started by another assistant)"}
          </li>
        ))}
      </ul>
    </section>
  );
}
