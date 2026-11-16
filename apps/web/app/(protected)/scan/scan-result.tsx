
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import EquipmentQrScanner from "@/components/equipment/equipment-qr-scanner";

type PickupMatch = {
  equipment: {
    id: string;
    name: string;
    status: string;
  };
  activeLoan: {
    id: string;
    dueDate: string;
  } | null;
  confirmedReservations: {
    id: string;
    startAt: string;
    endAt: string;
  }[];
};

type ScanResultProps = {
  canViewReservations: boolean;
};

export default function ScanResult({
  canViewReservations,
}: ScanResultProps) {
  const [scannedId, setScannedId] = useState<string | null>(null);
  const [match, setMatch] = useState<PickupMatch | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!scannedId || !canViewReservations) return;

    const controller = new AbortController();

    async function loadMatch() {
      setLoading(true);
      setMatch(null);
      setError(null);

      try {
        const response = await fetch(
          `/api/reservations/pickup?itemId=${encodeURIComponent(scannedId!)}`,
          {
            signal: controller.signal,
            cache: "no-store",
          },
        );

        if (!response.ok) {
          if (response.status === 403) {
            throw new Error(
              "You do not have permission to view pickup information.",
            );
          }

          if (response.status === 404) {
            throw new Error("Equipment not found.");
          }

          throw new Error(
            "Unable to retrieve reservation information. Please try again.",
          );
        }

        const data: PickupMatch = await response.json();

        if (!controller.signal.aborted) {
          setMatch(data);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to retrieve reservation information.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadMatch();

    return () => controller.abort();
  }, [scannedId, canViewReservations]);

  return (
    <section className="space-y-6">
      <EquipmentQrScanner onScan={setScannedId} />

      {scannedId && (
        <div className="max-w-lg space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Equipment QR Code Scanned
            </h2>

            <p className="mt-2 text-sm text-slate-600">
              Equipment UUID:
            </p>

            <p className="mt-1 break-all font-mono text-sm text-slate-800">
              {scannedId}
            </p>

            {!canViewReservations && (
              <p className="mt-3 text-sm text-slate-600">
                Equipment UUID identified successfully. Reservation and
                loan details are available to laboratory assistants only.
              </p>
            )}
          </div>

          {canViewReservations && loading && (
            <p role="status" className="text-sm text-slate-600">
              Checking reservations and active loans...
            </p>
          )}

          {canViewReservations && error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            >
              {error}
            </div>
          )}

          {canViewReservations && match && (
            <div className="space-y-4">
              <div className="rounded-lg bg-slate-50 p-4">
                <h3 className="font-semibold text-slate-900">
                  {match.equipment.name}
                </h3>

                <p className="mt-1 text-sm text-slate-600">
                  Status: {match.equipment.status}
                </p>
              </div>

              {match.activeLoan ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <h3 className="font-semibold text-amber-900">
                    Active Loan Found
                  </h3>

                  <p className="mt-2 text-sm text-amber-800">
                    Due date:{" "}
                    {new Date(
                      match.activeLoan.dueDate,
                    ).toLocaleString()}
                  </p>

                  <Link
                    href={`/return/${match.activeLoan.id}`}
                    className="mt-3 inline-block rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800"
                  >
                    View Return
                  </Link>
                </div>
              ) : match.confirmedReservations.length > 0 ? (
                <div className="space-y-3">
                  <h3 className="font-semibold text-slate-900">
                    Confirmed Reservations
                  </h3>

                  {match.confirmedReservations.map((reservation) => (
                    <div
                      key={reservation.id}
                      className="rounded-lg border border-blue-200 bg-blue-50 p-4"
                    >
                      <p className="text-sm text-blue-900">
                        Start:{" "}
                        {new Date(
                          reservation.startAt,
                        ).toLocaleString()}
                      </p>

                      <p className="mt-1 text-sm text-blue-900">
                        End:{" "}
                        {new Date(
                          reservation.endAt,
                        ).toLocaleString()}
                      </p>

                      <p className="mt-3 text-sm text-blue-800">
                        Reservation confirmed. Pickup eligibility
                        must be verified before handover.
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
                  No confirmed reservation or active loan found for
                  this equipment.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
