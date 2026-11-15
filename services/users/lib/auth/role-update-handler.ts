import { isProfileId } from "@unitrack/contracts";
import { usersFailure } from "../errors";
import { AuthorizationError } from "./errors";
import {
  isProfileRole,
  type Profile,
  type ProfileRole,
} from "./model";

export type RoleUpdateDependencies = {
  authorizeManager: () => Promise<Profile>;
  updateRoleInLab: (
    userId: string,
    role: ProfileRole,
    labId: number,
  ) => Promise<Profile | null>;
};


export async function handleRoleUpdate(
  request: Request,
  userId: string,
  dependencies: RoleUpdateDependencies,
) {
  try {
    const manager = await dependencies.authorizeManager();

    if (!isProfileId(userId)) {
      return Response.json({ error: "Invalid user id." }, { status: 400 });
    }

    const body = await readJson(request);
    if (!body || !isProfileRole(body.role)) {
      return Response.json(
        { error: "role must be a supported profile role." },
        { status: 400 },
      );
    }

    const updatedProfile = await dependencies.updateRoleInLab(
      userId,
      body.role,
      manager.lab_id,
    );

    if (!updatedProfile) {
      return Response.json(
        { error: "User was not found in your laboratory." },
        { status: 404 },
      );
    }

    return Response.json({ profile: updatedProfile });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    const unavailable = usersFailure(error);
    if (unavailable.status === 503) return unavailable;
    return Response.json(
      { error: "Unable to update the role." },
      { status: 500 },
    );
  }
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
