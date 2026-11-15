
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
    <div
      style={{
        maxWidth: "420px",
        padding: "20px",
        border: "1px solid #d1d5db",
        borderRadius: "10px",
        backgroundColor: "#ffffff",
        color: "#111827",
      }}
    >
      <h2
        style={{
          fontSize: "20px",
          fontWeight: 600,
          marginBottom: "12px",
        }}
      >
        Scan Equipment QR Code
      </h2>

      <p
        style={{
          fontSize: "14px",
          marginBottom: "16px",
        }}
      >
        Scan a UniTrack equipment QR code to read its UUID.
      </p>

      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        style={{
          width: "100%",
          minHeight: "200px",
          backgroundColor: "#111827",
          borderRadius: "8px",
          display:
            isScanning || isStarting ? "block" : "none",
        }}
      />

      {error && (
        <p
          role="alert"
          style={{
            marginTop: "12px",
            color: "#b91c1c",
            fontSize: "14px",
          }}
        >
          {error}
        </p>
      )}

      <div style={{ marginTop: "16px" }}>
        {isScanning || isStarting ? (
          <button
            type="button"
            onClick={stopScanner}
            style={{
              padding: "10px 16px",
              backgroundColor: "#dc2626",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Stop Scanner
          </button>
        ) : (
          <button
            type="button"
            onClick={startScanner}
            style={{
              padding: "10px 16px",
              backgroundColor: "#111827",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Start Scanner
          </button>
        )}
      </div>

      <div
        style={{
          marginTop: "24px",
          paddingTop: "20px",
          borderTop: "1px solid #d1d5db",
        }}
      >
        <h3
          style={{
            fontSize: "16px",
            fontWeight: 600,
            marginBottom: "8px",
          }}
        >
          Enter Equipment UUID Manually
        </h3>

        <p
          style={{
            fontSize: "14px",
            color: "#4b5563",
            marginBottom: "12px",
          }}
        >
          If you cannot use the camera, enter the
          equipment UUID below.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleManualSubmit();
          }}
        >
          <label
            htmlFor="manual-equipment-uuid"
            style={{
              display: "block",
              fontSize: "14px",
              fontWeight: 600,
              marginBottom: "6px",
            }}
          >
            Equipment UUID
          </label>

          <input
            id="manual-equipment-uuid"
            type="text"
            value={manualId}
            onChange={(event) =>
              setManualId(event.target.value)
            }
            placeholder="Enter equipment UUID"
            autoComplete="off"
            spellCheck={false}
            style={{
              width: "100%",
              padding: "10px",
              border: "1px solid #9ca3af",
              borderRadius: "6px",
              boxSizing: "border-box",
              fontSize: "14px",
            }}
          />

          <button
            type="submit"
            style={{
              marginTop: "12px",
              padding: "10px 16px",
              backgroundColor: "#1d4ed8",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Submit Equipment UUID
          </button>
        </form>
      </div>
    </div>
  );
}
