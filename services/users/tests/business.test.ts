import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signInternalToken } from "@unitrack/internal-auth";
import type { InternalIdentity, UserProfile } from "@unitrack/contracts";
vi.mock("server-only", () => ({}));
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../lib/db", () => ({ getDatabasePool: () => ({ query }) }));
import { GET as lookup } from "../app/profiles/[id]/route";
import { GET as listing } from "../app/profiles/route";
import { GET as batch } from "../app/profiles/batch/route";
import { PATCH as role } from "../app/profiles/[id]/role/route";
import { GET as health } from "../app/health/route";
const secret = "public-dummy-users-unit-secret-not-for-deployment";
const managerId = "05910d42-6dc7-4fdb-a65a-7b1043b03e58";
const targetId = "1b853b74-1797-4f67-9aa8-36618e8bd949";
const foreignId = "550e8400-e29b-41d4-a716-446655440000";
const manager: UserProfile = { id: managerId, full_name: "Manager", university_email: "manager@mail.aub.edu", role: "lab_manager", lab_id: 7, is_active: true };
const student: UserProfile = { ...manager, id: targetId, full_name: "Borrower", university_email: "student@mail.aub.edu", role: "student" };
const gateway: InternalIdentity = { kind: "service", sub: "gateway", role: "service", lab_id: null, rid: "request-gateway" };
let rows: Map<string, UserProfile>;
const identity = (profile: UserProfile): InternalIdentity => ({ kind: "user", sub: profile.id, role: profile.role, lab_id: profile.lab_id, rid: "request-user" });
const context = { params: Promise.resolve({ id: targetId }) };
function req(path: string, method = "GET", token?: string, body?: unknown) { return new Request("http://users.test" + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
const endpoints = [["lookup", (r: Request) => lookup(r, context)], ["listing", listing], ["batch", batch], ["role", (r: Request) => role(r, context)]] as const;
beforeEach(() => {
 vi.stubEnv("INTERNAL_JWT_SECRET", secret); rows = new Map([[managerId, { ...manager }], [targetId, { ...student }], [foreignId, { ...student, id: foreignId, lab_id: 8 }]]);
 query.mockReset().mockImplementation(async (sql: string, values: unknown[]) => {
  if (sql.includes("UPDATE public.profiles")) { const p = rows.get(String(values[1])); if (!p || p.lab_id !== values[2]) return { rows: [] }; const updated = { ...p, role: values[0] as UserProfile["role"] }; rows.set(p.id, updated); return { rows: [updated] }; }
  if (sql.includes("ANY($1")) return { rows: [...rows.values()].filter(p => (values[0] as string[]).includes(p.id) && p.lab_id === values[1]) };
  if (sql.includes("WHERE lab_id")) return { rows: [...rows.values()].filter(p => p.lab_id === values[0]) };
  return { rows: rows.has(String(values[0])) ? [rows.get(String(values[0]))] : [] };
 });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe("Users business authentication", () => {
 it.each(endpoints)("requires verified tokens on %s", async (_name, handle) => { for (const token of [undefined, "bad-token"]) expect((await handle(req("/profiles", "GET", token))).status).toBe(401); expect(query).not.toHaveBeenCalled(); });
 it("rejects expired tokens and wrong signatures", async () => {
  vi.useFakeTimers(); const token = await signInternalToken(gateway, secret); vi.advanceTimersByTime(60000);
  expect((await lookup(req("/profiles/" + targetId, "GET", token), context)).status).toBe(401);
  vi.useRealTimers(); expect((await listing(req("/profiles?labId=7", "GET", await signInternalToken(identity(manager), "wrong-public-dummy-secret")))).status).toBe(401);
 });
 it("allows profile bootstrap only for the gateway service identity", async () => {
  const response = await lookup(req("/profiles/" + targetId, "GET", await signInternalToken(gateway, secret)), context);
  expect(await response.json()).toEqual(student);
  expect((await lookup(req("/profiles/" + targetId, "GET", await signInternalToken(identity(manager), secret)), context)).status).toBe(403);
 });
 it("keeps unknown and inactive profiles distinct for trusted bootstrap checks", async () => {
  const token = await signInternalToken(gateway, secret); rows.delete(targetId);
  expect((await lookup(req("/profiles/" + targetId, "GET", token), context)).status).toBe(404);
  rows.set(targetId, { ...student, is_active: false });
  expect((await (await lookup(req("/profiles/" + targetId, "GET", token), context)).json()).is_active).toBe(false);
 });
 it.each(["listing", "batch", "role"])("denies service identity on user operation %s", async name => {
  const handle = endpoints.find(([n]) => n === name)![1];
  expect((await handle(req("/profiles", "GET", await signInternalToken(gateway, secret)))).status).toBe(403); expect(query).not.toHaveBeenCalled();
 });
 it("denies student/stale/inactive or moved-lab privileged users", async () => {
  expect((await batch(req("/profiles/batch?ids=" + targetId, "GET", await signInternalToken(identity(student), secret)))).status).toBe(403);
  const token = await signInternalToken(identity(manager), secret);
  for (const changed of [{ is_active: false }, { role: "student" as const }, { lab_id: 8 }]) {
   rows.set(managerId, { ...manager, ...changed });
   expect((await listing(req("/profiles?labId=7", "GET", token))).status).toBe(403);
  }
 });
 it("refuses professors on staff borrower-name lookup", async () => {
  const professor = { ...manager, role: "professor" as const }; rows.set(managerId, professor);
  expect((await batch(req("/profiles/batch?ids=" + targetId, "GET", await signInternalToken(identity(professor), secret)))).status).toBe(403);
 });
 it("keeps health public with no secret or database", async () => { vi.stubEnv("INTERNAL_JWT_SECRET", ""); expect(health().status).toBe(200); expect(query).not.toHaveBeenCalled(); });
});
describe("Users scope, validation and privacy", () => {
 it("lists only the manager's current lab and rejects cross-lab query input", async () => {
  const token = await signInternalToken(identity(manager), secret);
  expect((await listing(req("/profiles?labId=8", "GET", token))).status).toBe(403);
  const response = await listing(req("/profiles?labId=7", "GET", token));
  expect((await response.json()).map((p: UserProfile) => p.id)).toEqual([managerId, targetId]);
 });
 it.each(["", "0", "-1", "1e0", "1.5", "7%0A", "9007199254740992"])("validates labId %s", async value => { expect((await listing(req("/profiles?labId=" + value, "GET", await signInternalToken(identity(manager), secret)))).status).toBe(400); });
 it.each(["bad", targetId + "\n"])("validates profile IDs %j", async id => {
  const c = { params: Promise.resolve({ id }) };
  expect((await lookup(req("/profiles/one", "GET", await signInternalToken(gateway, secret)), c)).status).toBe(400);
  expect((await role(req("/profiles/one/role", "PATCH", await signInternalToken(identity(manager), secret), { role: "student" }), c)).status).toBe(400);
 });
 it.each([null, [], { role: "admin" }, { role: 1 }])("validates role bodies %j", async body => { expect((await role(req("/profiles/one/role", "PATCH", await signInternalToken(identity(manager), secret), body), context)).status).toBe(400); });
 it("changes only same-lab targets and ignores body actor/lab claims", async () => {
  const token = await signInternalToken(identity(manager), secret);
  const response = await role(req("/profiles/one/role", "PATCH", token, { role: "professor", lab_id: 8, changed_by: foreignId }), context);
  expect(response.status).toBe(200); expect((await response.json()).profile).toEqual({ ...student, role: "professor" });
  const update = query.mock.calls.find(([sql]) => sql.includes("UPDATE public.profiles")); expect(update?.[1]).toEqual(["professor", targetId, 7]);
  expect((await role(req("/profiles/one/role", "PATCH", token, { role: "professor" }), { params: Promise.resolve({ id: foreignId }) })).status).toBe(404);
  expect(rows.get(foreignId)?.role).toBe("student");
 });
 it("refreshes role identity and rejects an old privileged token after demotion", async () => {
  const token = await signInternalToken(identity(manager), secret);
  expect((await role(req("/profiles/self/role", "PATCH", token, { role: "student" }), { params: Promise.resolve({ id: managerId }) })).status).toBe(200);
  expect((await listing(req("/profiles?labId=7", "GET", token))).status).toBe(403);
  const fresh = await lookup(req("/profiles/self", "GET", await signInternalToken(gateway, secret)), { params: Promise.resolve({ id: managerId }) });
  expect((await fresh.json()).role).toBe("student");
 });
 it("limits batches before deduplication and returns only same-lab names", async () => {
  const token = await signInternalToken(identity(manager), secret);
  for (const ids of [Array(101).fill(targetId).join(","), "invalid"]) expect((await batch(req("/profiles/batch?ids=" + ids, "GET", token))).status).toBe(400);
  const response = await batch(req("/profiles/batch?ids=" + [targetId, foreignId, targetId].join(","), "GET", token));
  expect(await response.json()).toEqual([{ id: targetId, full_name: "Borrower" }]);
  const call = query.mock.calls.find(([sql]) => sql.includes("ANY($1")); expect(call?.[1]).toEqual([[targetId, foreignId], 7]);
 });
 it("allows lab assistants to retrieve names without manager profile fields", async () => {
  const staff = { ...manager, role: "lab_assistant" as const }; rows.set(managerId, staff);
  const response = await batch(req("/profiles/batch?ids=" + targetId, "GET", await signInternalToken(identity(staff), secret)));
  expect(await response.json()).toEqual([{ id: targetId, full_name: "Borrower" }]);
 });
 it("sanitizes SQL/schema faults without leaking messages or logging credentials", async () => {
  const logs = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log")];
  query.mockRejectedValue(Object.assign(new Error(secret + " private SQL"), { code: "42703" }));
  const response = await lookup(req("/profiles/one", "GET", await signInternalToken(gateway, secret)), context);
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "Users database schema is not ready.", code: "users_schema_not_ready" });
  for (const log of logs) expect(log).not.toHaveBeenCalled();
 });
});

it("rejects non-UUID signed user subjects before database access", async () => {
 const token = await signInternalToken({ kind: "user", sub: "not-a-profile-uuid", role: "lab_manager", lab_id: 7, rid: "request-bad-subject" }, secret);
 expect((await listing(req("/profiles?labId=7", "GET", token))).status).toBe(401); expect(query).not.toHaveBeenCalled();
});
