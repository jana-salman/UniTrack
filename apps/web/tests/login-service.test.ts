import { describe, expect, it, vi } from "vitest";

import {
  authenticateWithPassword,
  type LoginDependencies,
} from "@/lib/auth/login-service";
import type { Profile } from "@/lib/auth/model";

const activeStudent: Profile = {
  id: "4ec62f81-9d2a-4e3c-8ea7-5693a7d2a001",
  full_name: "Active Student",
  university_email: "student@mail.aub.edu",
  role: "student",
  lab_id: 1,
  is_active: true,
};

function dependencies(
  overrides: Partial<LoginDependencies> = {},
): LoginDependencies {
  return {
    signIn: vi.fn().mockResolvedValue({
      id: activeStudent.id,
      email: activeStudent.university_email,
    }),
    signOut: vi.fn().mockResolvedValue(undefined),
    findProfile: vi.fn().mockResolvedValue(activeStudent),
    ...overrides,
  };
}

describe("authenticateWithPassword", () => {
  it.each(["mail.aub.edu", "aub.edu.lb"])(
    "accepts valid credentials from the %s domain",
    async (domain) => {
      const email = `student@${domain}`;
      const deps = dependencies({
        signIn: vi.fn().mockResolvedValue({ id: activeStudent.id, email }),
        findProfile: vi.fn().mockResolvedValue({
          ...activeStudent,
          university_email: email,
        }),
      });

      const result = await authenticateWithPassword(
        ` Student@${domain.toUpperCase()} `,
        "valid-password",
        ["mail.aub.edu", "aub.edu.lb"],
        deps,
      );

      expect(result).toEqual({ ok: true });
      expect(deps.signIn).toHaveBeenCalledWith(email, "valid-password");
    },
  );

  it.each(["incorrect password", "unknown account"])(
    "returns a generic invalid-credentials response for %s",
    async () => {
      const deps = dependencies({
        signIn: vi.fn().mockResolvedValue(null),
      });

      const result = await authenticateWithPassword(
        activeStudent.university_email,
        "wrong-password",
        ["mail.aub.edu", "aub.edu.lb"],
        deps,
      );

      expect(result).toMatchObject({
        ok: false,
        code: "invalid_credentials",
      });
      expect(deps.findProfile).not.toHaveBeenCalled();
    },
  );

  it("rejects a non-university email before contacting Supabase", async () => {
    const deps = dependencies();

    const result = await authenticateWithPassword(
      "student@gmail.com",
      "password",
      ["mail.aub.edu", "aub.edu.lb"],
      deps,
    );

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_email_domain",
    });
    expect(deps.signIn).not.toHaveBeenCalled();
  });

  it("rejects an inactive profile and clears the new local session", async () => {
    const deps = dependencies({
      findProfile: vi.fn().mockResolvedValue({
        ...activeStudent,
        is_active: false,
      }),
    });

    const result = await authenticateWithPassword(
      activeStudent.university_email,
      "password",
      ["mail.aub.edu", "aub.edu.lb"],
      deps,
    );

    expect(result).toMatchObject({ ok: false, code: "inactive_profile" });
    expect(deps.signOut).toHaveBeenCalledOnce();
  });
});
