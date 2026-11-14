import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { verifyInternalToken } from "@unitrack/internal-auth";
import type { InternalIdentity, UserProfile } from "@unitrack/contracts";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ query: vi.fn(), getUser: vi.fn() }));
vi.mock("../../../services/users/lib/db", () => ({ getDatabasePool: () => ({ query: mocks.query }) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
import { getAuthenticatedProfile, requireRole } from "@/lib/auth/authorization";
import { findProfileById, listProfilesByLab } from "@/lib/profiles";
import { callUsers } from "@/lib/gateway/users-client";
import { authenticateWithPassword } from "@/lib/auth/login-service";
import { PATCH } from "@/app/api/users/[id]/role/route";
const root = fileURLToPath(new URL("../../../services/users/", import.meta.url)).replaceAll("\\", "/");
const secret = "public-dummy-users-http-secret-not-for-deployment";
const manager: UserProfile = { id: "05910d42-6dc7-4fdb-a65a-7b1043b03e58", full_name: "Manager", university_email: "manager@mail.aub.edu", role: "lab_manager", lab_id: 7, is_active: true };
const student: UserProfile = { ...manager, id: "1b853b74-1797-4f67-9aa8-36618e8bd949", full_name: "Student", university_email: "student@mail.aub.edu", role: "student" };
const foreign: UserProfile = { ...student, id: "550e8400-e29b-41d4-a716-446655440000", lab_id: 8, full_name: "Other lab" };
let rows: Map<string, UserProfile>; let session = { id: manager.id, email: manager.university_email };
const identities: InternalIdentity[] = []; let cookiesSeen = false; let calls = 0; let unexpected404 = false;
const server = createServer();
beforeAll(async () => {
 const single = await import(root + "app/profiles/[id]/route.ts");
 const listing = await import(root + "app/profiles/route.ts");
 const batch = await import(root + "app/profiles/batch/route.ts");
 const role = await import(root + "app/profiles/[id]/role/route.ts");
 server.on("request", async (incoming, outgoing) => {
  try {
   calls++; cookiesSeen ||= Boolean(incoming.headers.cookie);
   if (unexpected404) { outgoing.writeHead(404, { "Content-Type": "application/json" }); outgoing.end('{"error":"Wrong upstream route."}'); return; }
   identities.push(await verifyInternalToken(incoming.headers.authorization?.slice(7), secret));
   const url = new URL("http://127.0.0.1" + incoming.url);
   const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
   const headers = new Headers(); for (const [key, value] of Object.entries(incoming.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
   const req = new Request(url, { method: incoming.method, headers, ...(incoming.method === "GET" ? {} : { body: Buffer.concat(chunks).toString() }) });
   const parts = url.pathname.split("/"); const context = { params: Promise.resolve({ id: decodeURIComponent(parts[2] ?? "") }) };
   const response = url.pathname === "/profiles" ? await listing.GET(req) : url.pathname === "/profiles/batch" ? await batch.GET(req) : incoming.method === "PATCH" ? await role.PATCH(req, context) : await single.GET(req, context);
   outgoing.writeHead(response.status, { "Content-Type": "application/json" }); outgoing.end(await response.text());
  } catch { outgoing.writeHead(500, { "Content-Type": "application/json" }); outgoing.end('{"error":"Isolated Users fixture failed."}'); }
 });
 await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
beforeEach(() => {
 unexpected404 = false; calls = 0; identities.length = 0; cookiesSeen = false; session = { id: manager.id, email: manager.university_email };
 rows = new Map([manager, student, foreign].map(p => [p.id, { ...p }]));
 const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture unavailable");
 vi.stubEnv("USERS_SERVICE_URL", "http://127.0.0.1:" + address.port); vi.stubEnv("INTERNAL_JWT_SECRET", secret); vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "mail.aub.edu,aub.edu.lb");
 mocks.getUser.mockReset().mockImplementation(async () => ({ data: { user: session }, error: null }));
 mocks.query.mockReset().mockImplementation(async (sql: string, values: unknown[]) => {
  if (sql.includes("UPDATE public.profiles")) { const p = rows.get(String(values[1])); if (!p || p.lab_id !== values[2]) return { rows: [] }; const updated = { ...p, role: values[0] as UserProfile["role"] }; rows.set(p.id, updated); return { rows: [updated] }; }
  if (sql.includes("ANY($1")) return { rows: [...rows.values()].filter(p => (values[0] as string[]).includes(p.id) && p.lab_id === values[1]) };
  if (sql.includes("WHERE lab_id")) return { rows: [...rows.values()].filter(p => p.lab_id === values[0]) };
  return { rows: rows.has(String(values[0])) ? [rows.get(String(values[0]))] : [] };
 });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
function browser(role = "professor") { return new Request("http://web.test/api/users/" + student.id + "/role", { method: "PATCH", headers: { Authorization: "Bearer browser-forged-manager-token", "X-Role": "lab_manager", "X-Lab-Id": "8", Cookie: "browser-session-marker" }, body: JSON.stringify({ role, sub: foreign.id, lab_id: 8 }) }); }
const identity = (p: UserProfile): InternalIdentity => ({ kind: "user", sub: p.id, role: p.role, lab_id: p.lab_id, rid: "user-request" });
describe("real Users HTTP communication with isolated Supabase/DB fixtures", () => {
 it("bootstraps after verified Supabase getUser with no recursive user authorization", async () => {
  expect(await getAuthenticatedProfile()).toEqual(manager); expect(calls).toBe(1); expect(mocks.getUser).toHaveBeenCalledOnce();
  expect(identities).toEqual([{ kind: "service", sub: "gateway", role: "service", lab_id: null, rid: expect.any(String) }]); expect(cookiesSeen).toBe(false);
 });
 it("serves manager page data through same-lab HTTP", async () => {
  const actor = await getAuthenticatedProfile(); const result = await listProfilesByLab(actor);
  expect(result).toEqual([manager, student]); expect(identities.map(i => i.kind)).toEqual(["service", "user"]);
 });
 it("keeps role API URL/shape and signs the verified manager, not browser claims", async () => {
  const response = await PATCH(browser(), { params: Promise.resolve({ id: student.id }) });
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ profile: { ...student, role: "professor" } });
  expect(identities[1]).toMatchObject({ kind: "user", sub: manager.id, role: "lab_manager", lab_id: 7 }); expect(cookiesSeen).toBe(false);
  expect(rows.get(foreign.id)?.role).toBe("student");
 });
 it("rejects a student's manager mutation despite forged browser authorization", async () => {
  session = { id: student.id, email: student.university_email };
  const response = await PATCH(browser("lab_manager"), { params: Promise.resolve({ id: student.id }) });
  expect(response.status).toBe(403); expect(rows.get(student.id)?.role).toBe("student");
  expect(mocks.query.mock.calls.some(([sql]) => sql.includes("UPDATE"))).toBe(false);
 });
 it("authorizes malformed role-change requests before reporting body errors", async () => {
  const malformed = () => new Request("http://web.test/api/users/" + student.id + "/role", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{invalid-json" });
  const context = { params: Promise.resolve({ id: student.id }) };
  session = { id: student.id, email: student.university_email };
  expect((await PATCH(malformed(), context)).status).toBe(403);
  session = { id: manager.id, email: manager.university_email };
  const response = await PATCH(malformed(), context);
  expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "role must be a supported profile role." });
  expect(mocks.query.mock.calls.some(([sql]) => sql.includes("UPDATE"))).toBe(false);
 });
 it("refreshes role on the next permission check after a same-lab change", async () => {
  session = { id: student.id, email: student.university_email }; await expect(requireRole(["lab_manager"])).rejects.toMatchObject({ status: 403 });
  session = { id: manager.id, email: manager.university_email };
  expect((await PATCH(browser("lab_manager"), { params: Promise.resolve({ id: student.id }) })).status).toBe(200);
  session = { id: student.id, email: student.university_email };
  await expect(requireRole(["lab_manager"])).resolves.toMatchObject({ id: student.id, role: "lab_manager" });
 });
 it("rejects missing provisioned and inactive profiles without issuing user identities", async () => {
  rows.delete(manager.id); await expect(getAuthenticatedProfile()).rejects.toMatchObject({ status: 403, code: "profile_not_found" });
  rows.set(manager.id, { ...manager, is_active: false }); await expect(getAuthenticatedProfile()).rejects.toMatchObject({ status: 403, code: "profile_inactive" });
  expect(identities.every(i => i.kind === "service")).toBe(true);
 });
 it("rejects non-university users before any Users HTTP request", async () => {
  session.email = "outside@example.test";
  await expect(getAuthenticatedProfile()).rejects.toMatchObject({ status: 403, code: "invalid_email_domain" }); expect(calls).toBe(0);
 });
 it("rejects mismatched profile emails or response subject identities", async () => {
  rows.set(manager.id, { ...manager, university_email: student.university_email });
  await expect(getAuthenticatedProfile()).rejects.toMatchObject({ status: 403, code: "profile_not_found" });
  mocks.query.mockResolvedValue({ rows: [foreign] });
  await expect(getAuthenticatedProfile()).rejects.toMatchObject({ status: 503, code: "users_unavailable" });
 });
 it("does not let service and user identities cross restricted endpoint boundaries", async () => {
  const actor = await getAuthenticatedProfile();
  expect((await callUsers("/profiles/" + student.id, identity(actor))).status).toBe(403);
  expect((await callUsers("/profiles?labId=7", { kind: "service", sub: "gateway", role: "service", lab_id: null, rid: "bootstrap" })).status).toBe(403);
 });
 it("keeps borrower-name batches staff-only, same-lab and minimal", async () => {
  const staff = { ...student, role: "lab_assistant" as const }; rows.set(student.id, staff); session = { id: student.id, email: student.university_email };
  const actor = await getAuthenticatedProfile();
  const response = await callUsers("/profiles/batch?ids=" + [manager.id, foreign.id].join(","), identity(actor));
  expect(await response.json()).toEqual([{ id: manager.id, full_name: manager.full_name }]);
 });
 it("preserves login outcomes and clears inactive/unknown sessions through the HTTP adapter", async () => {
  for (const mode of ["inactive", "unknown"] as const) {
   if (mode === "inactive") rows.set(manager.id, { ...manager, is_active: false }); else rows.delete(manager.id);
   const signOut = vi.fn();
   const result = await authenticateWithPassword(manager.university_email, "public-dummy-password", ["mail.aub.edu"], { signIn: async () => ({ id: manager.id, email: manager.university_email }), signOut, findProfile: findProfileById });
   expect(result).toMatchObject({ ok: false, code: mode === "inactive" ? "inactive_profile" : "missing_profile" }); expect(signOut).toHaveBeenCalledOnce();
  }
 });
 it("sanitizes SQL/upstream failures on auth, role API and login logs", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.query.mockRejectedValue(Object.assign(new Error(secret + " raw SQL credentials"), { code: "42P01" }));
  await expect(getAuthenticatedProfile()).rejects.toMatchObject({ status: 503, message: "User profiles are temporarily unavailable." });
  const response = await PATCH(browser(), { params: Promise.resolve({ id: student.id }) }); expect(response.status).toBe(503); expect(await response.text()).not.toContain(secret);
  const result = await authenticateWithPassword(manager.university_email, "public-dummy-password", ["mail.aub.edu"], { signIn: async () => ({ id: manager.id, email: manager.university_email }), signOut: vi.fn(), findProfile: findProfileById });
  expect(result).toMatchObject({ ok: false, code: "service_unavailable" });
  expect(JSON.stringify(log.mock.calls)).not.toContain(secret); expect(JSON.stringify(log.mock.calls)).not.toContain("raw SQL");
 });
 it("distinguishes unexpected upstream 404 from a missing provisioned profile", async () => {
  unexpected404 = true;
  await expect(getAuthenticatedProfile()).rejects.toMatchObject({ status: 503, code: "users_unavailable" });
 });
 it("fails closed for missing Users configuration without SQL fallback", async () => {
  vi.stubEnv("USERS_SERVICE_URL", "");
  await expect(getAuthenticatedProfile()).rejects.toMatchObject({ status: 503, code: "users_unavailable" }); expect(calls).toBe(0); expect(mocks.query).not.toHaveBeenCalled();
 });
});
