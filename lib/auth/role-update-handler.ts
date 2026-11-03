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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function handleRoleUpdate(
  request: Request,
  userId: string,
  dependencies: RoleUpdateDependencies,
) {
  try {
    const manager = await dependencies.authorizeManager();

    if (!UUID_PATTERN.test(userId)) {
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

    console.error("Role update failed", error);
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
