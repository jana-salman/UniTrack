
"use client";

import { useRef } from "react";
import QRCode from "react-qr-code";
import { createEquipmentQrLabel } from "@/lib/qr/qr-label";

type EquipmentQrLabelProps = {
  itemId: string;
  name: string;
  assetCode: string;
};

export default function EquipmentQrLabel({
  itemId,
  name,
  assetCode,
}: EquipmentQrLabelProps) {
  const labelRef = useRef<HTMLDivElement>(null);

  const label = createEquipmentQrLabel(
    name,
    assetCode,
    itemId
  );

  function handlePrint() {
    if (!labelRef.current) return;

    const printWindow = window.open("", "_blank");

    if (!printWindow) {
      alert("Please allow pop-ups to print the QR label.");
      return;
    }

    const labelHtml = labelRef.current.outerHTML;

    printWindow.document.open();
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Equipment QR Label</title>
          <style>
            body {
              margin: 0;
              padding: 20px;
              display: flex;
              justify-content: center;
              font-family: Arial, sans-serif;
              background: white;
            }

            .qr-label {
              width: 260px;
              padding: 16px;
              border: 1px solid #d1d5db;
              border-radius: 8px;
              text-align: center;
              box-sizing: border-box;
              color: #111827;
              background: white;
            }

            @media print {
              body {
                padding: 0;
              }
            }
          </style>
        </head>
        <body>
          ${labelHtml}
        </body>
      </html>
    `);
    printWindow.document.close();

    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
    };
  }

  return (
    <div>
      <div
        ref={labelRef}
        className="qr-label"
        style={{
          width: "260px",
          padding: "16px",
          border: "1px solid #d1d5db",
          borderRadius: "8px",
          backgroundColor: "#ffffff",
          color: "#111827",
          textAlign: "center",
        }}
      >
        <h3
          style={{
            margin: "0 0 8px",
            fontSize: "16px",
            fontWeight: 600,
            overflowWrap: "anywhere",
          }}
        >
          {label.name}
        </h3>

        <div
          style={{
            backgroundColor: "#ffffff",
            padding: "8px",
            display: "flex",
            justifyContent: "center",
          }}
        >
          <QRCode
            value={label.qrPayload}
            size={180}
            bgColor="#FFFFFF"
            fgColor="#000000"
            level="M"
          />
        </div>

        <p
          style={{
            margin: "8px 0 0",
            fontSize: "14px",
            fontWeight: 600,
            overflowWrap: "anywhere",
          }}
        >
          {label.assetCode}
        </p>
      </div>

      <button
        type="button"
        onClick={handlePrint}
        style={{
          marginTop: "12px",
          padding: "10px 16px",
          borderRadius: "6px",
          backgroundColor: "#111827",
          color: "#ffffff",
          border: "none",
          cursor: "pointer",
        }}
      >
        Print QR Label
      </button>
    </div>
  );
}
