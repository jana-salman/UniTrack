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
          className="min-h-12 rounded-lg border border-slate-300 px-3 text-slate-950 outline-none focus:border-aub-600 focus:ring-3 focus:ring-aub-100"
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
          className="min-h-12 rounded-lg border border-slate-300 px-3 text-slate-950 outline-none focus:border-aub-600 focus:ring-3 focus:ring-aub-100"
          autoComplete="current-password"
          id="password"
          minLength={1}
          name="password"
          required
          type="password"
        />
      </div>

      {state.error ? (
        <p aria-live="polite" className="notice-panel text-sm" role="alert">
          {state.error}
        </p>
      ) : null}

      <button className="action-primary w-full" disabled={pending || domains.length === 0} type="submit">
        {pending ? "Signing in…" : "Sign in"}
      </button>

      {domains.length === 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          University sign-in is unavailable. Contact your administrator.
        </p>
      ) : null}
    </form>
  );
}
