
"use client";

import { useEffect, useRef, useState } from "react";
import {
  BrowserQRCodeReader,
  type IScannerControls,
} from "@zxing/browser";

type EquipmentQrScannerProps = {
  onScan: (itemId: string) => void;
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function EquipmentQrScanner({
  onScan,
}: EquipmentQrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const activeRef = useRef(false);

  const [isScanning, setIsScanning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function stopScanner() {
    activeRef.current = false;
    controlsRef.current?.stop();
    controlsRef.current = null;

    setIsScanning(false);
    setIsStarting(false);
  }

  async function startScanner() {
    if (activeRef.current) return;

    setError(null);
    setIsStarting(true);
    activeRef.current = true;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Camera access is unavailable. Use localhost or HTTPS."
        );
      }

      const reader = new BrowserQRCodeReader();

      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current ?? undefined,
        (result, _error, scannerControls) => {
          if (!result || !activeRef.current) return;

          const scannedText = result.getText().trim();

          if (!UUID_REGEX.test(scannedText)) {
            setError(
              "Invalid equipment QR code. Expected an equipment UUID."
            );
            return;
          }

          activeRef.current = false;
          scannerControls.stop();
          controlsRef.current = null;

          setIsScanning(false);
          setIsStarting(false);
          setError(null);

          onScan(scannedText);
        }
      );

      if (!activeRef.current) {
        controls.stop();
        return;
      }

      controlsRef.current = controls;
      setIsScanning(true);
      setIsStarting(false);
    } catch (err) {
      activeRef.current = false;
      setIsScanning(false);
      setIsStarting(false);

      if (
        err instanceof DOMException &&
        (err.name === "NotAllowedError" ||
          err.name === "PermissionDeniedError")
      ) {
        setError(
          "Camera permission was denied. Allow camera access and try again."
        );
      } else if (
        err instanceof DOMException &&
        err.name === "NotFoundError"
      ) {
        setError("No camera was found on this device.");
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to start the camera."
        );
      }
    }
  }

  useEffect(() => {
    return () => {
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
          display: isScanning || isStarting ? "block" : "none",
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
    </div>
  );
}
