import { describe, expect, it, vi } from "vitest";

import { AuthorizationError } from "@/lib/auth/errors";
import type { Profile } from "@/lib/auth/model";
import { handleRoleUpdate } from "@/lib/auth/role-update-handler";

const targetId = "1b853b74-1797-4f67-9aa8-36618e8bd949";

const manager: Profile = {
  id: "05910d42-6dc7-4fdb-a65a-7b1043b03e58",
  full_name: "Lab Manager",
  university_email: "manager@unitrack.edu",
  role: "lab_manager",
  lab_id: 7,
  is_active: true,
};

function request(role = "professor") {
  return new Request(`http://localhost/api/users/${targetId}/role`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
}

describe("manager role update handler", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const dependencies = {
      authorizeManager: vi.fn().mockRejectedValue(
        new AuthorizationError(401, "unauthenticated", "Sign in is required."),
      ),
      updateRoleInLab: vi.fn(),
    };

    const response = await handleRoleUpdate(request(), targetId, dependencies);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "unauthenticated",
    });
  });

  it("returns 403 when the authenticated user is not a lab manager", async () => {
    const dependencies = {
      authorizeManager: vi.fn().mockRejectedValue(
        new AuthorizationError(
          403,
          "insufficient_role",
          "You do not have permission to perform this action.",
        ),
      ),
      updateRoleInLab: vi.fn(),
    };

    const response = await handleRoleUpdate(request(), targetId, dependencies);

    expect(response.status).toBe(403);
  });

  it("updates a supported role only within the manager's laboratory", async () => {
    const updatedProfile: Profile = {
      ...manager,
      id: targetId,
      full_name: "Professor User",
      role: "professor",
    };
    const updateRoleInLab = vi.fn().mockResolvedValue(updatedProfile);
    const dependencies = {
      authorizeManager: vi.fn().mockResolvedValue(manager),
      updateRoleInLab,
    };

    const response = await handleRoleUpdate(
      request("professor"),
      targetId,
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(updateRoleInLab).toHaveBeenCalledWith(
      targetId,
      "professor",
      manager.lab_id,
    );
    await expect(response.json()).resolves.toEqual({ profile: updatedProfile });
  });

  it("does not update a user outside the manager's laboratory", async () => {
    const dependencies = {
      authorizeManager: vi.fn().mockResolvedValue(manager),
      updateRoleInLab: vi.fn().mockResolvedValue(null),
    };

    const response = await handleRoleUpdate(request(), targetId, dependencies);

    expect(response.status).toBe(404);
  });
});
