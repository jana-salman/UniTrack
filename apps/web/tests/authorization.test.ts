import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Profile } from "@/lib/auth/model";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  forwardUsers: vi.fn(),
  findProfileById: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/gateway/users", () => ({ forwardUsers: mocks.forwardUsers }));
vi.mock("@/lib/profiles", () => ({
  findProfileById: mocks.findProfileById,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: mocks.getUser },
  }),
}));

import { requireRole } from "@/lib/auth/authorization";
import { PATCH } from "@/app/api/users/[id]/role/route";

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

  it("preserves the sanitized Users failure as the authorization cause", async () => {
    const cause = new Error("Users service returned HTTP 504.");
    mocks.findProfileById.mockRejectedValue(cause);

    await expect(requireRole(["lab_manager"])).rejects.toMatchObject({
      status: 503,
      code: "users_unavailable",
      cause,
    });
  });

  it("uses an updated role on the next permission check", async () => {
    let currentProfile = student;
    mocks.findProfileById.mockImplementation(async () => currentProfile);

    await expect(requireRole(["lab_manager"])).rejects.toMatchObject({
      status: 403,
    });

    mocks.forwardUsers.mockImplementation(async () => {
      currentProfile = { ...currentProfile, role: "lab_manager" };
      return Response.json({ profile: currentProfile });
    });
    const response = await PATCH(
      new Request(`http://localhost/api/users/${userId}/role`, { method: "PATCH", body: JSON.stringify({ role: "lab_manager" }) }),
      { params: Promise.resolve({ id: userId }) },
    );

    expect(response.status).toBe(200);
    await expect(requireRole(["lab_manager"])).resolves.toMatchObject({
      id: userId,
      role: "lab_manager",
    });
  });
});
