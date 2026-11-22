"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import EquipmentQrLabel from "./equipment-qr-label";

type EquipmentItem = {
  id: string;
  asset_code: string;
  name: string;
  serial_number: string | null;
  status: string;
  condition: string;
};

type EquipmentLookupClientProps = {
  canReplaceQrLabel: boolean;
  canMatchPickup: boolean;
};

function isEquipmentItem(data: unknown): data is EquipmentItem {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const item = data as Record<string, unknown>;

  return (
    typeof item.id === "string" &&
    typeof item.asset_code === "string" &&
    typeof item.name === "string" &&
    (item.serial_number === null ||
      typeof item.serial_number === "string") &&
    typeof item.status === "string" &&
    typeof item.condition === "string"
  );
}

export default function EquipmentLookupClient({
  canReplaceQrLabel,
  canMatchPickup,
}: EquipmentLookupClientProps) {
  const [identifier, setIdentifier] = useState("");
  const [item, setItem] = useState<EquipmentItem | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const search = identifier.trim();

    setItem(null);
    setError("");

    if (!search || search.length > 100) {
      setError("Enter an equipment ID, asset code, or serial number.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(
        `/api/items/lookup?q=${encodeURIComponent(search)}`,
        { cache: "no-store" }
      );

      const data: unknown = await response.json();

      if (!response.ok) {
        const message =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : "Could not find equipment.";

        throw new Error(message);
      }

      if (!isEquipmentItem(data)) {
        throw new Error("Invalid equipment response.");
      }

      setItem(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-6">
      <form onSubmit={handleSearch} className="panel space-y-4 p-4 sm:p-5">
        <label
          htmlFor="equipment-identifier"
          className="block font-semibold text-slate-900"
        >
          Equipment ID, asset code, or serial number
        </label>

        <input
          id="equipment-identifier"
          type="text"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          placeholder="Enter equipment identifier"
          maxLength={100}
          className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900"
        />

        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-aub-700 px-5 py-3 font-semibold text-white disabled:opacity-50"
        >
          {loading ? "Searching..." : "Find Equipment"}
        </button>
      </form>

      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}

      {item && (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-xl font-bold text-slate-900">
            {item.name}
          </h2>

          <div className="space-y-2 text-sm text-slate-700">
            <p>
              <strong>Asset Code:</strong> {item.asset_code}
            </p>

            <p>
              <strong>Serial Number:</strong>{" "}
              {item.serial_number ?? "N/A"}
            </p>

            <p>
              <strong>Status:</strong> {item.status}
            </p>

            <p>
              <strong>Condition:</strong> {item.condition}
            </p>

            <p className="break-all">
              <strong>Equipment UUID:</strong> {item.id}
            </p>
          </div>

          {canMatchPickup && (
            <Link className="action-primary" href={`/scan?itemId=${encodeURIComponent(item.id)}`}>
              Check pickup or return
            </Link>
          )}

          {canReplaceQrLabel && (
            <div className="space-y-3">
              <h3 className="font-semibold text-slate-900">
                Replacement QR Label
              </h3>

              <p className="text-sm text-slate-600">
                Print a replacement label using this equipment&apos;s
                existing ID.
              </p>

              <EquipmentQrLabel
                itemId={item.id}
                name={item.name}
                assetCode={item.asset_code}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}