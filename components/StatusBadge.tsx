// Shows an item's status as a coloured label. The text is always shown,
// so the meaning never depends on colour alone.
// SC: the status names must match exactly what the database stores.
const COLOURS: Record<string, { bg: string; fg: string }> = {
  Available: { bg: "#dcfce7", fg: "#166534" },
  Reserved: { bg: "#e0e7ff", fg: "#3730a3" },
  Borrowed: { bg: "#fef3c7", fg: "#92400e" },
  "Inspection Required": { bg: "#fee2e2", fg: "#991b1b" },
  "Under Repair": { bg: "#fee2e2", fg: "#991b1b" },
  Overdue: { bg: "#fee2e2", fg: "#991b1b" },
  Lost: { bg: "#e5e7eb", fg: "#111827" },
};

export default function StatusBadge({ status }: { status: string }) {
  const c = COLOURS[status] ?? { bg: "#e5e7eb", fg: "#374151" };
  return (
    <span
      style={{
        background: c.bg,
        color: c.fg,
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}