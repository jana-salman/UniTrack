"use client";

import { useState } from "react";

import {
  PROFILE_ROLES,
  roleLabel,
  type Profile,
  type ProfileRole,
} from "@/lib/auth/model";

export function RoleEditor({ profile }: { profile: Profile }) {
  const [role, setRole] = useState<ProfileRole>(profile.role);
  const [savedRole, setSavedRole] = useState<ProfileRole>(profile.role);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function updateRole() {
    setPending(true);
    setMessage("");

    try {
      const response = await fetch(`/api/users/${profile.id}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const result: { error?: string; profile?: Profile } = await response.json();

      if (!response.ok || !result.profile) {
        setMessage(result.error ?? "Unable to update role.");
        return;
      }

      setSavedRole(result.profile.role);
      setRole(result.profile.role);
      setMessage("Role updated.");
    } catch {
      setMessage("Unable to update role.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid grid-cols-[minmax(9rem,1fr)_auto] items-center gap-2">
      <label className="sr-only" htmlFor={`role-${profile.id}`}>
        Role for {profile.full_name}
      </label>
      <select
        className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-900 outline-none focus:border-blue-600 focus:ring-3 focus:ring-blue-100"
        id={`role-${profile.id}`}
        onChange={(event) => setRole(event.target.value as ProfileRole)}
        value={role}
      >
        {PROFILE_ROLES.map((value) => (
          <option key={value} value={value}>
            {roleLabel(value)}
          </option>
        ))}
      </select>
      <button
        className="min-h-10 rounded-lg border border-slate-300 bg-slate-50 px-4 font-semibold text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={pending || role === savedRole}
        onClick={updateRole}
        type="button"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <span aria-live="polite" className="col-span-full min-h-4 text-xs text-slate-500">
        {message}
      </span>
    </div>
  );
}
