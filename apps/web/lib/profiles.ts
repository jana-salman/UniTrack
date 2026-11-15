import "server-only";
import { getRequestId } from "@unitrack/internal-auth";
import { isUserProfile, type UserProfile as Profile } from "@unitrack/contracts";
import { callUsers, UsersServiceUnavailableError } from "./gateway/users-client";
function profile(value: unknown): Profile {
 if (!isUserProfile(value)) throw new UsersServiceUnavailableError();
 const { id, full_name, university_email, role, lab_id, is_active } = value;
 return { id, full_name, university_email, role, lab_id, is_active };
}
// Called only after trusted Supabase sign-in/getUser; never an arbitrary browser profile ID.
export async function findProfileById(userId: string): Promise<Profile | null> {
 const response = await callUsers("/profiles/" + encodeURIComponent(userId), { kind: "service", sub: "gateway", role: "service", lab_id: null, rid: getRequestId() });
 if (response.status === 404) {
  try { const body = await response.json(); if (body?.error === "User profile not found.") return null; } catch { /* Treat non-contract 404s as unavailable, not unknown users. */ }
  throw new UsersServiceUnavailableError();
 }
 if (!response.ok) throw new UsersServiceUnavailableError();
 try {
  const result = profile(await response.json());
  if (result.id.toLowerCase() !== userId.toLowerCase()) throw new UsersServiceUnavailableError();
  return result;
 } catch { throw new UsersServiceUnavailableError(); }
}
export async function listProfilesByLab(manager: Profile): Promise<Profile[]> {
 const response = await callUsers("/profiles?labId=" + manager.lab_id, { kind: "user", sub: manager.id, role: manager.role, lab_id: manager.lab_id, rid: getRequestId() });
 if (!response.ok) throw new UsersServiceUnavailableError();
 try {
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new UsersServiceUnavailableError();
  const rows = data.map(profile);
  if (rows.some(row => row.lab_id !== manager.lab_id)) throw new UsersServiceUnavailableError();
  return rows;
 } catch { throw new UsersServiceUnavailableError(); }
}
