import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Profile } from "@/lib/auth/model";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  findProfileById: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/profiles", () => ({
  findProfileById: mocks.findProfileById,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: mocks.getUser },
  }),
}));

import { requireRole } from "@/lib/auth/authorization";
import { handleRoleUpdate } from "@/lib/auth/role-update-handler";

const userId = "1b853b74-1797-4f67-9aa8-36618e8bd949";
const student: Profile = {
  id: userId,
  full_name: "Demo Student",
  university_email: "student@mail.aub.edu",
  role: "student",
  lab_id: 7,
  is_active: true,
};

beforeEach(() => {
  process.env.ALLOWED_EMAIL_DOMAINS = "mail.aub.edu,aub.edu.lb";
  mocks.getUser.mockReset().mockResolvedValue({
    data: { user: { id: userId, email: student.university_email } },
    error: null,
  });
  mocks.findProfileById.mockReset().mockResolvedValue(student);
});

describe("role authorization", () => {
  it("returns 403 when a student requests lab-manager permission", async () => {
    await expect(requireRole(["lab_manager"])).rejects.toMatchObject({
      status: 403,
      code: "insufficient_role",
    });
  });

  it("returns 401 when the request has no authenticated user", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(requireRole(["lab_manager"])).rejects.toMatchObject({
      status: 401,
      code: "unauthenticated",
    });
  });

  it("uses an updated role on the next permission check", async () => {
    let currentProfile = student;
    mocks.findProfileById.mockImplementation(async () => currentProfile);

    await expect(requireRole(["lab_manager"])).rejects.toMatchObject({
      status: 403,
    });

    const response = await handleRoleUpdate(
      new Request(`http://localhost/api/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "lab_manager" }),
      }),
      userId,
      {
        authorizeManager: vi.fn().mockResolvedValue({
          ...student,
          id: "05910d42-6dc7-4fdb-a65a-7b1043b03e58",
          full_name: "Demo Manager",
          university_email: "manager@mail.aub.edu",
          role: "lab_manager",
        }),
        updateRoleInLab: vi.fn().mockImplementation(async (_id, role) => {
          currentProfile = { ...currentProfile, role };
          return currentProfile;
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(requireRole(["lab_manager"])).resolves.toMatchObject({
      id: userId,
      role: "lab_manager",
    });
  });
});
