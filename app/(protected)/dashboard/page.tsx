import { roleLabel } from "@/lib/auth/model";
import { requirePageProfile } from "@/lib/auth/authorization";

const roleContent = {
  student: {
    title: "My equipment activity",
    description: "Review your reservations, loans, and upcoming due dates.",
  },
  lab_assistant: {
    title: "Lab operations",
    description: "Support equipment checkouts, returns, and inspections for your lab.",
  },
  professor: {
    title: "Course equipment",
    description: "Plan equipment needs and review availability for your courses.",
  },
  lab_manager: {
    title: "Laboratory management",
    description: "Manage lab access, user roles, equipment, and operational oversight.",
  },
} as const;

export default async function DashboardPage() {
  const profile = await requirePageProfile();
  const content = roleContent[profile.role];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <section className="mb-10 max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">
          {roleLabel(profile.role)} workspace
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-5xl">
          Welcome, {profile.full_name}
        </h1>
        <p className="mt-3 leading-7 text-slate-600">
          You are signed in to laboratory {profile.lab_id}. Your permissions are
          loaded from your active university profile.
        </p>
      </section>

      <section className="grid gap-5 md:grid-cols-2" aria-label="Dashboard summary">
        <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <span className="block size-3 rounded-full bg-emerald-500 ring-4 ring-emerald-100" aria-hidden="true" />
          <h2 className="mt-5 text-lg font-semibold text-slate-950">{content.title}</h2>
          <p className="mt-2 leading-7 text-slate-600">{content.description}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <span className="block size-3 rounded-full bg-blue-600 ring-4 ring-blue-100" aria-hidden="true" />
          <h2 className="mt-5 text-lg font-semibold text-slate-950">Account status</h2>
          <p className="mt-2 leading-7 text-slate-600">
            Your UniTrack profile is active and ready to use.
          </p>
        </article>
      </section>
    </main>
  );
}
