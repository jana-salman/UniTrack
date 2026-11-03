"use client";

import { useActionState } from "react";

import { login, type LoginState } from "./actions";

const initialState: LoginState = {};

export function LoginForm({ domains }: { domains: string[] }) {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <form action={formAction} className="mt-8 grid gap-4">
      <div className="grid gap-2">
        <label className="text-sm font-semibold text-slate-800" htmlFor="email">University email</label>
        <input
          className="min-h-12 rounded-lg border border-slate-300 px-3 text-slate-950 outline-none focus:border-blue-600 focus:ring-3 focus:ring-blue-100"
          autoComplete="username"
          id="email"
          name="email"
          placeholder={domains.length ? `name@${domains[0]}` : "University email"}
          required
          type="email"
        />
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-semibold text-slate-800" htmlFor="password">Password</label>
        <input
          className="min-h-12 rounded-lg border border-slate-300 px-3 text-slate-950 outline-none focus:border-blue-600 focus:ring-3 focus:ring-blue-100"
          autoComplete="current-password"
          id="password"
          minLength={1}
          name="password"
          required
          type="password"
        />
      </div>

      {state.error ? (
        <p aria-live="polite" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}

      <button className="min-h-12 rounded-lg bg-blue-700 px-4 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50" disabled={pending || domains.length === 0} type="submit">
        {pending ? "Signing in…" : "Sign in"}
      </button>

      {domains.length === 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Login is disabled until ALLOWED_EMAIL_DOMAINS is configured.
        </p>
      ) : null}
    </form>
  );
}
