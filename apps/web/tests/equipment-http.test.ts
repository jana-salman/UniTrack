import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ profile: vi.fn(), query: vi.fn(), release: vi.fn() }));
vi.mock("@/lib/auth/authorization", () => ({ getAuthenticatedProfile: mocks.profile }));
vi.mock("../../../services/equipment/lib/db", () => ({
 pool: { query: mocks.query }, getDatabasePool: () => ({ query: mocks.query, connect: async () => ({ query: mocks.query, release: mocks.release }) }),
}));
import { GET, POST } from "@/app/api/items/route";
import { PATCH } from "@/app/api/items/[id]/status/route";
import { AuthorizationError } from "@/lib/auth/errors";
const serviceRoot = fileURLToPath(new URL("../../../services/equipment/", import.meta.url)).replaceAll("\\", "/");
const secret = "public-dummy-http-equipment-secret-not-for-deployment";
const id = "550e8400-e29b-41d4-a716-446655440000";
const profile = { id: "550e8400-e29b-41d4-a716-446655440001", role: "lab_manager", lab_id: 7, is_active: true };
let calls = 0;
let status = "available";
let receipts: Record<string, unknown>[] = [];
let snapshot: { status: string; receipts: Record<string, unknown>[] };
const paths: string[] = [];
const server = createServer();
beforeAll(async () => {
 const routes = await import(serviceRoot + "app/items/route.ts");
 const statusRoute = await import(serviceRoot + "app/items/[id]/status/route.ts");
 server.on("request", async (incoming, outgoing) => {
  try {
   calls++; const url = "http://127.0.0.1" + incoming.url; paths.push(new URL(url).pathname);
   const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
   const headers = new Headers(); for (const [key, value] of Object.entries(incoming.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
   const request = new Request(url, { method: incoming.method, headers, ...(incoming.method === "GET" ? {} : { body: Buffer.concat(chunks).toString() }) });
   const response = incoming.url?.startsWith("/items/" + id + "/status")
    ? await statusRoute.PATCH(request, { params: Promise.resolve({ id }) })
    : incoming.method === "POST" ? await routes.POST(request) : await routes.GET(request);
   outgoing.writeHead(response.status, { "Content-Type": "application/json" }); outgoing.end(await response.text());
  } catch { outgoing.writeHead(500, { "Content-Type": "application/json" }); outgoing.end('{"error":"Isolated fixture failed."}'); }
 });
 await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
beforeEach(() => {
 calls = 0; paths.length = 0; status = "available"; receipts = [];
 mocks.profile.mockReset().mockResolvedValue(profile); mocks.release.mockClear();
 const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture server unavailable");
 vi.stubEnv("EQUIPMENT_SERVICE_URL", "http://127.0.0.1:" + address.port); vi.stubEnv("INTERNAL_JWT_SECRET", secret);
 mocks.query.mockReset().mockImplementation(async (sql: string, values: unknown[] = []) => {
  if (sql === "BEGIN") snapshot = { status, receipts: structuredClone(receipts) };
  if (sql === "ROLLBACK") { status = snapshot.status; receipts = snapshot.receipts; }
  if (sql.includes("pg_advisory")) return { rows: [] };
  if (sql.includes('AS "assetCode"')) return { rows: [{ id, assetCode: "EQ-1", name: "Camera", category: "Cameras", status: "checked_out", expectedReturn: "old-value" }] };
  if (sql.includes("FOR UPDATE")) return { rows: values[1] === 7 ? [{ id, lab_id: 7, status }] : [] };
  if (sql.includes("FROM public.equipment_status_history")) return { rows: receipts.filter(r => r.request_key === values[0]) };
  if (sql.startsWith("UPDATE")) status = String(values[0]);
  if (sql.includes("INSERT INTO public.equipment_status_history")) receipts.push({ old_status: values[2], new_status: values[3], request_key: values[6], request_fingerprint: values[7] });
  if (sql.includes("INSERT INTO public.equipment_items")) return { rows: [{ id, asset_code: values[0], name: values[1], lab_id: values[5] }] };
  return { rows: [] };
 });
});
afterEach(() => vi.unstubAllEnvs());
function browser(method = "GET", body?: unknown, key?: string) {
 return new Request("http://web.test/api/items?search=camera&lab_id=999", { method, headers: { Authorization: "Bearer browser-forged-token", "X-Role": "lab_manager", "X-Lab-Id": "999", ...(key ? { "Idempotency-Key": key } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
describe("web gateway to real Equipment HTTP handlers with isolated DB", () => {
 it("uses verified profile identity over HTTP and preserves the catalogue shape", async () => {
  const response = await GET(browser()); expect(response.status).toBe(200);
  expect(await response.json()).toEqual([{ id, assetCode: "EQ-1", name: "Camera", category: "Cameras", status: "Borrowed", expectedReturn: null }]);
  expect(calls).toBe(1); expect(paths).toEqual(["/items"]);
  expect(mocks.query.mock.calls[0][1]).toEqual(["camera", "", 7]);
 });
 it("never signs browser role/user/lab claims on creation", async () => {
  const response = await POST(browser("POST", { asset_code: "EQ-2", name: "Camera 2", category_id: 1, role: "student", sub: "attacker", lab_id: 999, created_by: "attacker" }));
  expect(response.status).toBe(201); expect((await response.json()).lab_id).toBe(7);
  const insert = mocks.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO public.equipment_items"));
  expect(insert?.[1][5]).toBe(7); expect(insert?.[1][8]).toBe(profile.id);
 });
 it("preserves meaningful conflict errors and status request receipts over HTTP", async () => {
  const context = { params: Promise.resolve({ id }) };
  const conflict = await PATCH(browser("PATCH", { status: "checked_out", expectedStatus: "reserved" }), context);
  expect(conflict.status).toBe(409); expect(await conflict.json()).toEqual({ error: "Equipment status changed. Reload before trying again.", code: "equipment_status_conflict" });
  const body = { status: "checked_out", expectedStatus: ["available"], reason: "Pickup" };
  expect((await PATCH(browser("PATCH", body, "http:1"), context)).status).toBe(200);
  const replay = await PATCH(browser("PATCH", body, "http:1"), context);
  expect(await replay.json()).toEqual({ itemId: id, status: "checked_out", changed: true, alreadyApplied: true });
  expect(receipts).toHaveLength(1); expect(mocks.release).toHaveBeenCalledTimes(3);
  expect(paths.every(p => p === "/items/" + id + "/status")).toBe(true);
 });
 it("preserves field validation messages while hiding internal failures", async () => {
  const invalid = await POST(browser("POST", {}));
  expect(invalid.status).toBe(400); expect(await invalid.json()).toMatchObject({ error: "Invalid equipment data.", errors: expect.arrayContaining(["A valid category ID is required."]) });
  mocks.query.mockRejectedValue(Object.assign(new Error(secret + " raw SQL"), { code: "23505" }));
  const duplicate = await POST(browser("POST", { asset_code: "EQ-1", name: "Camera", category_id: 1 }));
  expect(duplicate.status).toBe(409); expect(await duplicate.json()).toEqual({ error: "An equipment item with this asset code already exists." });
 });
 it("preserves actionable sanitized schema failures over actual HTTP", async () => {
  mocks.query.mockRejectedValue(Object.assign(new Error(secret + " private SQL"), { code: "42703" }));
  const response = await GET(browser()); expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Equipment database schema is not ready.", code: "equipment_schema_not_ready" });
 });
 it("rejects an unverified browser before making a service call", async () => {
  mocks.profile.mockRejectedValue(new AuthorizationError(401, "unauthenticated", "Sign in is required."));
  expect((await GET(browser())).status).toBe(401); expect(calls).toBe(0); expect(mocks.query).not.toHaveBeenCalled();
 });
 it("sanitizes unavailable service and missing configuration", async () => {
  vi.stubEnv("EQUIPMENT_SERVICE_URL", "http://127.0.0.1:1");
  expect((await GET(browser())).status).toBe(502);
  vi.stubEnv("EQUIPMENT_SERVICE_URL", "");
  expect((await GET(browser())).status).toBe(503); expect(mocks.query).not.toHaveBeenCalled();
 });
});
