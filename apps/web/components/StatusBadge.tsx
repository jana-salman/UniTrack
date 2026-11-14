// Shows an item's status as a coloured label. The text is always shown,
// so the meaning never depends on colour alone.
// SC: the status names must match exactly what the database stores.
const COLOURS: Record<string, string> = {
  Available: "bg-green-100 text-green-800",
  Reserved: "bg-indigo-100 text-indigo-800",
  Borrowed: "bg-amber-100 text-amber-800",
  "Inspection Required": "bg-red-100 text-red-800",
  "Under Repair": "bg-red-100 text-red-800",
  Overdue: "bg-red-100 text-red-800",
  Lost: "bg-gray-200 text-gray-900",
};

export default function StatusBadge({ status }: { status: string }) {
  const colour = COLOURS[status] ?? "bg-gray-200 text-gray-700";
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-semibold ${colour}`}
    >
      {status}
    </span>
  );
}