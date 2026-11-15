
"use client";

import { useState } from "react";
import EquipmentQrScanner from "@/components/equipment/equipment-qr-scanner";

export default function ScanResult() {
  const [scannedId, setScannedId] = useState<string | null>(null);

  return (
    <section className="space-y-6">
      <EquipmentQrScanner onScan={setScannedId} />

      {scannedId && (
        <div className="max-w-lg rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="text-lg font-semibold text-emerald-900">
            Equipment QR Code Scanned!
          </h2>

          <p className="mt-2 text-sm text-emerald-800">
            Equipment UUID:
          </p>

          <p className="mt-1 break-all font-mono text-sm text-emerald-950">
            {scannedId}
          </p>

          <p className="mt-3 text-sm text-emerald-800">
            The equipment UUID has been read successfully.
          </p>
        </div>
      )}
    </section>
  );
}
