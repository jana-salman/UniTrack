import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({ logout: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/catalogue" }));

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

    const markup = renderToStaticMarkup(
      <AppNavigation profile={profile} />
    );

    expect(markup).toContain('href="/dashboard"');
    expect(markup).toContain(roleLabel(role));
    expect(markup).toContain("Laboratory 7");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-controls="workspace-menu-panel"');
    expect(markup).toMatch(/id="workspace-menu-panel"[^>]+hidden=""/);
    expect(markup.indexOf('aria-controls="workspace-menu-panel"')).toBeLessThan(
      markup.indexOf('alt="American University of Beirut"'),
    );
    expect(markup).toContain('src="/aub-logo-transparent.png"');
    expect(markup).toMatch(/href="\/catalogue" aria-current="page"|aria-current="page" href="\/catalogue"/);
    expect(markup.match(/aria-label="Primary navigation"/g)).toHaveLength(1);

    expect(markup.includes('href="/manager/users"')).toBe(
      role === "lab_manager"
    );
    expect(markup.includes('href="/manager/kits"')).toBe(
      role === "lab_manager"
    );

    expect(markup.includes('href="/equipment/lookup"')).toBe(
      role === "lab_assistant" ||
      role === "lab_manager" ||
      role === "professor"
    );

    expect(markup.includes('href="/scan"')).toBe(
      role !== "student"
    );
  });
});
