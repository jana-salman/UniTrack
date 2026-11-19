import { requirePageProfile } from "@/lib/auth/authorization";
import HandoverDetails from "./handover-details";

export default async function HandoverPage({
  params,
}: {
  params: Promise<{ reservationId: string }>;
}) {
  // Server-side page guard; the API gateway and Loans enforce it again.
  await requirePageProfile(["lab_assistant"]);

  const { reservationId } = await params;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <section className="mb-8 max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">
          Equipment Management
        </p>

        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-5xl">
          Hand Over Equipment
        </h1>

        <p className="mt-3 leading-7 text-slate-600">
          Check every item, record its condition, and ask the student to confirm.
        </p>
      </section>

      <HandoverDetails key={reservationId} reservationId={reservationId} />
    </main>
  );
}
