import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({ logout: vi.fn() }));

import { AppNavigation } from "@/components/app-navigation";
import {
  PROFILE_ROLES,
  roleLabel,
  type Profile,
} from "@/lib/auth/model";

describe("roles and navigation", () => {
  it("implements all four named roles", () => {
    expect(PROFILE_ROLES.map(roleLabel)).toEqual([
      "Student",
      "Lab Assistant",
      "Professor",
      "Lab Manager",
    ]);
  });

  it.each(PROFILE_ROLES)("shows the correct navigation for %s", (role) => {
    const profile: Profile = {
      id: "1b853b74-1797-4f67-9aa8-36618e8bd949",
      full_name: "Demo User",
      university_email: "demo@mail.aub.edu",
      role,
      lab_id: 7,
      is_active: true,
    };

    const markup = renderToStaticMarkup(<AppNavigation profile={profile} />);

    expect(markup).toContain('href="/dashboard"');
    expect(markup).toContain(roleLabel(role));
    expect(markup.includes('href="/manager/users"')).toBe(
      role === "lab_manager",
    );
  });
});
