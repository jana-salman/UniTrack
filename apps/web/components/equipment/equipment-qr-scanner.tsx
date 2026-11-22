
"use client";

import { useEffect, useRef, useState } from "react";
import {
  BrowserQRCodeReader,
  type IScannerControls,
} from "@zxing/browser";
import {
  createEquipmentQrPayload,
  isValidEquipmentQrPayload,
} from "@/lib/qr/qr-payload";

type EquipmentQrScannerProps = {
  onScan: (itemId: string) => void;
};

export default function EquipmentQrScanner({
  onScan,
}: EquipmentQrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const activeRef = useRef(false);
  const mountedRef = useRef(true);

  const [isScanning, setIsScanning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualId, setManualId] = useState("");

  function stopScanner() {
    activeRef.current = false;
    controlsRef.current?.stop();
    controlsRef.current = null;

    setIsScanning(false);
    setIsStarting(false);
  }

  function handleManualSubmit() {
    const enteredId = manualId.trim();

    if (!isValidEquipmentQrPayload(enteredId)) {
      setError(
        "Invalid equipment UUID. Enter a valid equipment ID."
      );
      return;
    }

    const itemId = createEquipmentQrPayload(enteredId);

    stopScanner();
    setError(null);
    onScan(itemId);
  }

  async function startScanner() {
    if (activeRef.current) return;

    setError(null);
    setIsStarting(true);
    activeRef.current = true;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Camera access is unavailable. Use HTTPS or enter the equipment UUID manually."
        );
      }

      const reader = new BrowserQRCodeReader();

      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current ?? undefined,
        (result, _error, scannerControls) => {
          if (!result || !activeRef.current) return;

          const scannedText = result.getText().trim();

          if (!isValidEquipmentQrPayload(scannedText)) {
            setError(
              "Invalid equipment QR code. Expected an equipment UUID."
            );
            return;
          }

          const itemId = createEquipmentQrPayload(scannedText);

          activeRef.current = false;
          scannerControls.stop();
          controlsRef.current = null;

          setIsScanning(false);
          setIsStarting(false);
          setError(null);

          onScan(itemId);
        }
      );

      if (!activeRef.current || !mountedRef.current) {
        controls.stop();
        return;
      }

      controlsRef.current = controls;
      setIsScanning(true);
      setIsStarting(false);
    } catch (err) {
      activeRef.current = false;
      controlsRef.current?.stop();
      controlsRef.current = null;

      if (!mountedRef.current) return;

      setIsScanning(false);
      setIsStarting(false);

      if (
        err instanceof DOMException &&
        (err.name === "NotAllowedError" ||
          err.name === "PermissionDeniedError")
      ) {
        setError(
          "Camera permission was denied. You can enter the equipment UUID manually below."
        );
      } else if (
        err instanceof DOMException &&
        err.name === "NotFoundError"
      ) {
        setError(
          "No camera was found. Enter the equipment UUID manually below."
        );
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to start the camera. Enter the UUID manually."
        );
      }
    }
  }

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      activeRef.current = false;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, []);

  return (
    <div className="panel w-full max-w-lg space-y-4 p-4 sm:p-5">
      <h2 className="text-xl font-semibold">Scan equipment QR code</h2>

      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        hidden={!isScanning && !isStarting}
        className="min-h-50 w-full rounded-lg bg-slate-950"
      />

      {error && <p role="alert" className="notice-panel text-sm">{error}</p>}

      {isScanning || isStarting ? (
        <button type="button" onClick={stopScanner} className="action-secondary">
          Stop Scanner
        </button>
      ) : (
        <button type="button" onClick={startScanner} className="action-primary">
          Start Scanner
        </button>
      )}

      <form
        className="grid gap-2 border-t border-slate-200 pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          handleManualSubmit();
        }}
      >
        <label className="font-semibold" htmlFor="manual-equipment-uuid">Equipment UUID</label>
        <p className="text-sm text-slate-600" id="manual-uuid-help">Enter the equipment UUID if the camera is unavailable.</p>
        <input
          id="manual-equipment-uuid"
          aria-describedby="manual-uuid-help"
          type="text"
          value={manualId}
          onChange={(event) => setManualId(event.target.value)}
          placeholder="Enter equipment UUID"
          autoComplete="off"
          spellCheck={false}
          className="min-h-11 min-w-0 rounded-lg border border-slate-300 bg-white px-3"
        />
        <button type="submit" className="action-secondary mt-1 justify-self-start">
          Submit Equipment UUID
        </button>
      </form>
    </div>
  );
}
