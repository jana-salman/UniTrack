
import { requirePageProfile } from "@/lib/auth/authorization";
import ScanResult from "./scan-result";

export default async function ScanPage() {
  await requirePageProfile([
    "lab_manager",
    "lab_assistant",
    "professor",
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <section className="mb-8 max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">
          Equipment Management
        </p>

        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-5xl">
          Scan Equipment
        </h1>

        <p className="mt-3 leading-7 text-slate-600">
          Scan an equipment QR code to identify an item using
          its unique equipment ID.
        </p>
      </section>

      <ScanResult />
    </main>
  );
}
