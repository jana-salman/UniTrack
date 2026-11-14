import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { construct } = vi.hoisted(() => ({ construct: vi.fn() }));
vi.mock("pg", () => ({ Pool: class { constructor(options: unknown) { construct(options); } } }));
import { getDatabasePool } from "../lib/db";
beforeEach(() => { globalThis.unitrackLoansPgPool = undefined; construct.mockClear(); });
afterEach(() => { globalThis.unitrackLoansPgPool = undefined; vi.unstubAllEnvs(); });
it("fails before opening a database connection when configuration is missing", () => {
  vi.stubEnv("DATABASE_URL", "");
  expect(() => getDatabasePool()).toThrow("configuration or schema"); expect(construct).not.toHaveBeenCalled();
});
it("requires explicit acknowledgement of session affinity and has no fallback", () => {
  vi.stubEnv("DATABASE_URL", "postgresql://public-dummy:dummy@invalid.test/fixture");
  vi.stubEnv("LOANS_DATABASE_SESSION_AFFINITY", "");
  expect(() => getDatabasePool()).toThrow("direct or session-pooled"); expect(construct).not.toHaveBeenCalled();
  vi.stubEnv("LOANS_DATABASE_SESSION_AFFINITY", "confirmed");
  expect(getDatabasePool()).toBeDefined(); expect(construct).toHaveBeenCalledOnce();
});
