import { connection } from "next/server";

import { getAllowedEmailDomains } from "@/lib/auth/email";
import { LoginForm } from "./login-form";

export const instant = false;

export default async function LoginPage() {
  await connection();

  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:p-10">
        <div className="mb-6 grid size-12 place-items-center rounded-xl bg-blue-700 text-xl font-extrabold text-white" aria-hidden="true">
          U
        </div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">
          University equipment services
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
          Sign in to UniTrack
        </h1>
        <p className="mt-3 leading-7 text-slate-600">
          Access is limited to pre-created, active university accounts.
        </p>
        <LoginForm domains={getAllowedEmailDomains()} />
      </section>
    </main>
  );
}
