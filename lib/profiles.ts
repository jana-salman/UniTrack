import "server-only";

import type { QueryResultRow } from "pg";

import { getDatabasePool } from "@/lib/db";
import {
  isProfileRole,
  type Profile,
  type ProfileRole,
} from "@/lib/auth/model";

type ProfileRow = QueryResultRow & Profile;

const PROFILE_COLUMNS = `
  id,
  full_name,
  university_email,
  role,
  lab_id,
  is_active
`;

export async function findProfileById(userId: string): Promise<Profile | null> {
  const result = await getDatabasePool().query<ProfileRow>(
    `SELECT ${PROFILE_COLUMNS}
     FROM public.profiles
     WHERE id = $1
     LIMIT 1`,
    [userId],
  );

  return result.rows[0] ? toProfile(result.rows[0]) : null;
}

export async function listProfilesByLab(labId: number): Promise<Profile[]> {
  const result = await getDatabasePool().query<ProfileRow>(
    `SELECT ${PROFILE_COLUMNS}
     FROM public.profiles
     WHERE lab_id = $1
     ORDER BY full_name, university_email`,
    [labId],
  );

  return result.rows.map(toProfile);
}

export async function updateProfileRoleInLab(
  userId: string,
  role: ProfileRole,
  labId: number,
): Promise<Profile | null> {
  const result = await getDatabasePool().query<ProfileRow>(
    `UPDATE public.profiles
     SET role = $1
     WHERE id = $2 AND lab_id = $3
     RETURNING ${PROFILE_COLUMNS}`,
    [role, userId, labId],
  );

  return result.rows[0] ? toProfile(result.rows[0]) : null;
}

function toProfile(row: ProfileRow): Profile {
  if (!isProfileRole(row.role)) {
    throw new Error(`Unsupported profile role in database: ${String(row.role)}`);
  }

  return {
    id: row.id,
    full_name: row.full_name,
    university_email: row.university_email,
    role: row.role,
    lab_id: row.lab_id,
    is_active: row.is_active,
  };
}
