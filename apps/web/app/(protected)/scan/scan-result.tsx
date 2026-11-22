"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import EquipmentQrScanner from "@/components/equipment/equipment-qr-scanner";

type PickupEligibility = "upcoming" | "eligible" | "expired";

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
    eligibility: PickupEligibility;
  }[];
  multipleEligibleReservations: boolean;
  canHandover: boolean;
};

type ScanResultProps = {
  canViewReservations: boolean;
};

const eligibilityLabels: Record<PickupEligibility, string> = {
  upcoming: "Upcoming",
  eligible: "Eligible for pickup",
  expired: "Pickup window expired",
};

const eligibilityStyles: Record<PickupEligibility, string> = {
  upcoming: "border-blue-200 bg-blue-50 text-blue-900",
  eligible: "border-emerald-200 bg-emerald-50 text-emerald-900",
  expired: "border-slate-200 bg-slate-50 text-slate-600",
};

const handoverEquipmentStatuses = new Set(["available", "reserved"]);

export default function ScanResult({
  canViewReservations,
}: ScanResultProps) {
  const [scan, setScan] = useState<{
    itemId: string;
  } | null>(null);

  const [match, setMatch] = useState<PickupMatch | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scannedId = scan?.itemId ?? null;

  function handleScan(itemId: string) {
    setMatch(null);
    setError(null);
    setLoading(canViewReservations);
    setScan({ itemId });
  }

  useEffect(() => {
    if (!scan || !canViewReservations) return;

    const controller = new AbortController();
    const itemId = scan.itemId;

    async function loadMatch() {
      try {
        const response = await fetch(
          `/api/reservations/pickup?itemId=${encodeURIComponent(itemId)}`,
          {
            signal: controller.signal,
            cache: "no-store",
          },
        );

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error("Please sign in again.");
          }

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
  }, [scan, canViewReservations]);

  return (
    <section className="space-y-6">
      <EquipmentQrScanner onScan={handleScan} />

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

          {canViewReservations && (
            <button
              type="button"
              disabled={loading}
              onClick={() => handleScan(scannedId)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Refresh matching results
            </button>
          )}

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
                  Status: {match.equipment.status.replaceAll("_", " ")}
                </p>
              </div>

              {match.activeLoan && (
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
              )}

              {match.multipleEligibleReservations && (
                <div
                  role="alert"
                  className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
                >
                  Multiple reservations are currently eligible.
                  Resolve the conflict before proceeding with handover.
                </div>
              )}

              {match.confirmedReservations.length > 0 && (
                <div className="space-y-3">
                  <h3 className="font-semibold text-slate-900">
                    Confirmed Reservations
                  </h3>

                  {match.confirmedReservations.map((reservation) => {
                    const canProceedToHandover =
                      match.canHandover &&
                      reservation.eligibility === "eligible" &&
                      match.equipment.id.toLowerCase() ===
                        scannedId.toLowerCase() &&
                      handoverEquipmentStatuses.has(match.equipment.status);

                    return (
                      <div
                        key={reservation.id}
                        className={`rounded-lg border p-4 ${
                          eligibilityStyles[reservation.eligibility]
                        }`}
                      >
                        <h4 className="text-sm font-semibold">
                          {eligibilityLabels[reservation.eligibility]}
                        </h4>

                        <p className="mt-2 text-sm">
                          Start:{" "}
                          {new Date(
                            reservation.startAt,
                          ).toLocaleString()}
                        </p>

                        <p className="mt-1 text-sm">
                          End:{" "}
                          {new Date(
                            reservation.endAt,
                          ).toLocaleString()}
                        </p>

                        {canProceedToHandover ? (
                          <Link
                            href={`/handover/${encodeURIComponent(reservation.id)}`}
                            className="mt-3 inline-block rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
                          >
                            Proceed to Handover
                          </Link>
                        ) : (
                          <button
                            type="button"
                            disabled
                            className="mt-3 cursor-not-allowed rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-500"
                          >
                            Handover unavailable
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {!match.activeLoan &&
                match.confirmedReservations.length === 0 && (
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
