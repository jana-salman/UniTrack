import { requirePageProfile } from "@/lib/auth/authorization";
import ReturnDetails from "./return-details";

export default async function ReturnPage({
  params,
}: {
  params: Promise<{ loanId: string }>;
}) {
  await requirePageProfile(["lab_assistant"]);

  const { loanId } = await params;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <section className="mb-8 max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">
          Equipment Management
        </p>

        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-5xl">
          Return Equipment
        </h1>

        <p className="mt-3 leading-7 text-slate-600">
          Compare the returned equipment with its pickup record.
        </p>
      </section>

      <ReturnDetails key={loanId} loanId={loanId} />
    </main>
  );
}