import Link from "next/link";

import { logout } from "@/app/actions";

export default function UnauthorizedPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 px-4 py-10">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:p-10">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-700">Access denied</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
          This account cannot access that page
        </h1>
        <p className="mt-3 leading-7 text-slate-600">
          Your profile may be inactive, missing, or assigned a different role or
          laboratory.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-slate-50 px-4 font-semibold text-slate-800 hover:bg-slate-100" href="/dashboard">
            Return to dashboard
          </Link>
          <form action={logout}>
            <button className="min-h-11 rounded-lg bg-blue-700 px-4 font-semibold text-white hover:bg-blue-800" type="submit">
              Sign in with another account
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
