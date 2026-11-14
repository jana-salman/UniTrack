import { isUserProfile, isProfileId, type ProfileName } from "@unitrack/contracts";
import { UsersError } from "./errors";
import "server-only";

import type { QueryResultRow } from "pg";

import { getDatabasePool } from "./db";
import {
  type Profile,
  type ProfileRole,
} from "./auth/model";

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
  if (!isUserProfile(row)) throw new UsersError(503, "users_schema_not_ready", "Users database schema is not ready.");

  return {
    id: row.id,
    full_name: row.full_name,
    university_email: row.university_email,
    role: row.role,
    lab_id: row.lab_id,
    is_active: row.is_active,
  };
}

export async function findProfileNames(ids: string[], labId: number): Promise<ProfileName[]> {
  if (!ids.length) return [];
  const result = await getDatabasePool().query<ProfileName>("SELECT id, full_name FROM public.profiles WHERE id = ANY($1::uuid[]) AND lab_id = $2 ORDER BY id", [ids, labId]);
  return result.rows.map(row => {
    if (!isProfileId(row.id) || typeof row.full_name !== "string") throw new UsersError(503, "users_schema_not_ready", "Users database schema is not ready.");
    return { id: row.id, full_name: row.full_name };
  });
}
