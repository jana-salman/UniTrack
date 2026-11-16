
import { requirePageProfile } from "@/lib/auth/authorization";
import EquipmentLookupClient from "@/components/equipment/equipment-lookup-client";

export default async function EquipmentLookupPage() {
  await requirePageProfile([
    "lab_manager",
    "lab_assistant",
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <section className="mb-8 max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">
          Equipment Management
        </p>

        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-5xl">
          Find Equipment
        </h1>

        <p className="mt-3 leading-7 text-slate-600">
          Search for equipment using its UUID, asset code,
          or serial number. You can also print a replacement
          QR label for damaged or missing labels.
        </p>
      </section>

      <EquipmentLookupClient />
    </main>
  );
}
