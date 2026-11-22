// S2-09: GET /profiles/:id/borrower (staff-only, same-lab identity status).
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { signInternalToken } from "@unitrack/internal-auth";
vi.mock("server-only", () => ({}));
const db = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>() }));
vi.mock("../lib/db", () => ({ getDatabasePool: () => ({ query: async (_sql: string, values: unknown[]) => ({ rows: db.rows.has(String(values[0])) ? [db.rows.get(String(values[0]))] : [] }) }) }));
import { GET } from "../app/profiles/[id]/borrower/route";

const secret = "public-dummy-users-borrower-secret";
const assistantId = "7c9e6679-7425-40de-944b-e07fc1f91001", studentId = "7c9e6679-7425-40de-944b-e07fc1f91002", otherLabId = "7c9e6679-7425-40de-944b-e07fc1f91003";
const profile = (id: string, role: string, lab: number, active = true) => ({ id, full_name: "Name " + id.slice(-1), university_email: "p" + id.slice(-1) + "@lau.edu", role, lab_id: lab, is_active: active });
beforeEach(() => {
  vi.stubEnv("INTERNAL_JWT_SECRET", secret);
  db.rows = new Map([[assistantId, profile(assistantId, "lab_assistant", 7)], [studentId, profile(studentId, "student", 7)], [otherLabId, profile(otherLabId, "student", 8)]]);
});
afterEach(() => vi.unstubAllEnvs());
async function call(id: string, identity: Record<string, unknown> | null = { kind: "user", sub: assistantId, role: "lab_assistant", lab_id: 7, rid: "b" }) {
  const headers: Record<string, string> = identity ? { Authorization: "Bearer " + await signInternalToken(identity as never, secret) } : {};
  return GET(new Request("http://users.test/profiles/" + id + "/borrower", { headers }), { params: Promise.resolve({ id }) } as never);
}

it("returns only id, name, role, lab and active status for a same-lab borrower", async () => {
  const response = await call(studentId);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: studentId, full_name: "Name 2", role: "student", lab_id: 7, is_active: true });
});
it("reports a same-lab non-student's real role (Loans refuses it)", async () => {
  expect(await (await call(assistantId)).json()).toMatchObject({ id: assistantId, role: "lab_assistant", lab_id: 7 });
});
it("reports an inactive borrower as inactive (Loans decides to refuse)", async () => {
  db.rows.set(studentId, profile(studentId, "student", 7, false));
  expect(await (await call(studentId)).json()).toMatchObject({ is_active: false });
});
it("hides other laboratories and unknown profiles as 404", async () => {
  expect((await call(otherLabId)).status).toBe(404);
  expect((await call("7c9e6679-7425-40de-944b-e07fc1f91999")).status).toBe(404);
  expect((await call("not-a-uuid")).status).toBe(400);
});
it("rejects students, professors, service identities and missing tokens", async () => {
  db.rows.set(studentId, profile(studentId, "student", 7));
  expect((await call(studentId, { kind: "user", sub: studentId, role: "student", lab_id: 7, rid: "s" })).status).toBe(403);
  expect((await call(studentId, { kind: "service", sub: "gateway", role: "service", lab_id: null, rid: "g" })).status).toBe(403);
  expect((await call(studentId, null)).status).toBe(401);
});
it("rejects an assistant whose own profile is inactive", async () => {
  db.rows.set(assistantId, profile(assistantId, "lab_assistant", 7, false));
  expect((await call(studentId)).status).toBe(403);
});
