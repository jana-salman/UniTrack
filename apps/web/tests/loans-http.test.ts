import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { SignJWT } from "jose";
import { signInternalToken, verifyInternalToken } from "@unitrack/internal-auth";
import type { UserIdentity } from "@unitrack/contracts";
import { returnDatabase, loanId, itemId, actorId, borrowerId } from "../../../services/loans/tests/fixtures/return-db";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ loans: null as unknown, equipmentQuery: vi.fn(), usersQuery: vi.fn(), profile: vi.fn() }));
vi.mock("../../../services/loans/lib/db", () => ({ getDatabasePool: () => mocks.loans }));
vi.mock("../../../services/equipment/lib/db", () => ({ getDatabasePool: () => ({ query: mocks.equipmentQuery, connect: async () => ({ query: mocks.equipmentQuery, release() {} }) }) }));
vi.mock("../../../services/users/lib/db", () => ({ getDatabasePool: () => ({ query: mocks.usersQuery }) }));
vi.mock("@/lib/auth/authorization", () => ({ getAuthenticatedProfile: mocks.profile }));
import { GET, POST } from "@/app/api/returns/[loanId]/route";
import { GET as catalogue } from "@/app/api/items/route";
import { AuthorizationError } from "@/lib/auth/errors";
const root = fileURLToPath(new URL("../../../services/", import.meta.url)).replaceAll("\\", "/");
const secret = "public-dummy-loans-http-secret-not-for-deployment";
const actor: UserIdentity = { kind: "user", sub: actorId, role: "lab_assistant", lab_id: 7, rid: "return-http" };
const profile = { id: actorId, full_name: "Assistant", university_email: "assistant@mail.aub.edu", role: "lab_assistant", lab_id: 7, is_active: true };
const body = { conditions: [{ kitComponentId: null, conditionStatus: "good" }] };
let db: ReturnType<typeof returnDatabase>;
let status: string;
let owner: string | null;
let receipts: Record<string, unknown>[];
let snapshot: { status: string; owner: string | null; receipts: Record<string, unknown>[] };
let loseEquipmentResponse: boolean, failEquipment: boolean, undoConflict: boolean, loseUndoResponse: boolean, failDue: boolean, stallEquipmentBody: boolean, missingOwnerSchema: boolean;
const observed: { service: string; identity: UserIdentity; rid: string | null; key: string | null }[] = [];
const servers: Server[] = [];
let loansUrl: string, equipmentUrl: string, usersUrl: string;
async function serve(dispatch: (req: Request) => Promise<Response>, name: string): Promise<string> {
  const server = createServer(async (incoming: IncomingMessage, outgoing: ServerResponse) => {
    try {
      const headers = new Headers(); for (const [key, value] of Object.entries(incoming.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
      const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const req = new Request("http://127.0.0.1" + incoming.url, { method: incoming.method, headers, ...(incoming.method === "GET" ? {} : { body: Buffer.concat(chunks).toString() }) });
      const token = headers.get("authorization")?.slice(7);
      try { observed.push({ service: name, identity: await verifyInternalToken(token, secret) as UserIdentity, rid: headers.get("X-Request-Id"), key: headers.get("Idempotency-Key") }); } catch { /* Production handler must reject it. */ }
      if (name === "equipment" && failEquipment) { outgoing.writeHead(503, { "Content-Type": "application/json" }); outgoing.end(JSON.stringify({ error: secret + " raw upstream detail" })); return; }
      if (name === "loans" && failDue && req.url.includes("due-dates")) { outgoing.writeHead(503, { "Content-Type": "application/json" }); outgoing.end('{"error":"Unavailable"}'); return; }
      if (name === "equipment" && undoConflict && headers.get("Idempotency-Key")?.endsWith(":undo")) { status = "under_maintenance"; }
      const response = await dispatch(req);
      if (name === "equipment" && incoming.method === "PATCH" && stallEquipmentBody) {
        stallEquipmentBody = false; outgoing.writeHead(200, { "Content-Type": "application/json" }); outgoing.flushHeaders(); return;
      }
      // Drop TCP response AFTER the actual Equipment handler has committed.
      if (name === "equipment" && incoming.method === "PATCH" && ((loseEquipmentResponse && !headers.get("Idempotency-Key")?.endsWith(":undo")) || (loseUndoResponse && headers.get("Idempotency-Key")?.endsWith(":undo")))) {
        loseEquipmentResponse = false; loseUndoResponse = false; incoming.socket.destroy(); return;
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries())); outgoing.end(await response.text());
    } catch { outgoing.writeHead(500, { "Content-Type": "application/json" }); outgoing.end('{"error":"Isolated fixture failure"}'); }
  });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture unavailable"); return "http://127.0.0.1:" + address.port;
}
beforeAll(async () => {
  const returns = await import(root + "loans/app/returns/[loanId]/route.ts");
  const due = await import(root + "loans/app/loans/due-dates/route.ts");
  const item = await import(root + "equipment/app/items/[id]/route.ts");
  const change = await import(root + "equipment/app/items/[id]/status/route.ts");
  const components = await import(root + "equipment/app/items/[id]/components/route.ts");
  const items = await import(root + "equipment/app/items/route.ts");
  const names = await import(root + "users/app/profiles/batch/route.ts");
  loansUrl = await serve(req => req.url.includes("due-dates") ? due.GET(req) : req.method === "POST" ? returns.POST(req, { params: Promise.resolve({ loanId: new URL(req.url).pathname.split("/")[2] }) }) : returns.GET(req, { params: Promise.resolve({ loanId: new URL(req.url).pathname.split("/")[2] }) }), "loans");
  equipmentUrl = await serve(req => new URL(req.url).pathname === "/items" ? items.GET(req) : req.url.endsWith("/status") ? change.PATCH(req, { params: Promise.resolve({ id: itemId }) }) : req.url.endsWith("/components") ? components.GET(req, { params: Promise.resolve({ id: itemId }) }) : item.GET(req, { params: Promise.resolve({ id: itemId }) }), "equipment");
  usersUrl = await serve(req => names.GET(req), "users");
});
afterAll(async () => { for (const server of servers) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } });
beforeEach(() => {
  db = returnDatabase(); mocks.loans = db.pool; status = "checked_out"; owner = null; receipts = []; observed.length = 0;
  loseEquipmentResponse = false; loseUndoResponse = false; failEquipment = false; undoConflict = false; failDue = false;
  stallEquipmentBody = false;
  missingOwnerSchema = false;
  vi.stubEnv("INTERNAL_JWT_SECRET", secret); vi.stubEnv("LOANS_SERVICE_URL", loansUrl); vi.stubEnv("EQUIPMENT_SERVICE_URL", equipmentUrl); vi.stubEnv("USERS_SERVICE_URL", usersUrl);
  mocks.profile.mockReset().mockResolvedValue(profile);
  mocks.usersQuery.mockReset().mockImplementation(async (sql: string) => ({ rows: sql.includes("ANY(") ? [{ id: borrowerId, full_name: "Same-lab borrower" }] : [profile] }));
  mocks.equipmentQuery.mockReset().mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (missingOwnerSchema && sql.includes("status_request_key")) throw Object.assign(new Error(secret + " private schema detail"), { code: "42703" });
    if (sql === "BEGIN") snapshot = { status, owner, receipts: structuredClone(receipts) };
    if (sql === "ROLLBACK") { status = snapshot.status; owner = snapshot.owner; receipts = snapshot.receipts; }
    if (sql.includes('AS "assetCode"')) return { rows: [{ id: itemId, assetCode: "EQ-1", name: "Camera", category: "Cameras", status, expectedReturn: null }] };
    if (sql.includes("FOR UPDATE")) return { rows: values[1] === 7 ? [{ id: itemId, lab_id: 7, status, status_request_key: owner }] : [] };
    if (sql.includes("FROM public.equipment_status_history")) return { rows: receipts.filter(r => r.request_key === values[0]) };
    if (sql.startsWith("UPDATE public.equipment_items")) { status = String(values[0]); owner = null; }
    if (sql.includes("INSERT INTO public.equipment_status_history")) { owner = typeof values[6] === "string" ? values[6] : null; receipts.push({ old_status: values[2], new_status: values[3], request_key: values[6], request_fingerprint: values[7] }); }
    if (sql.includes("FROM public.kit_components")) return { rows: [{ id: "550e8400-e29b-41d4-a716-446655440004", component_name: "Charger" }] };
    if (sql.includes("FROM public.equipment_items") && sql.includes("ANY(")) return { rows: values[1] === 7 ? [{ id: itemId, name: "Camera", lab_id: 7, status }] : [] };
    return { rows: [] };
  });
});
afterEach(() => vi.unstubAllEnvs());
const context = () => ({ params: Promise.resolve({ loanId }) });
function browser(method = "POST", value: unknown = body) { return new Request("http://web.test/api/returns/" + loanId, { method, headers: { "Content-Type": "application/json", "X-Request-Id": "return-http", Authorization: "Bearer browser-forged", "X-Role": "lab_manager", "X-Lab-Id": "999" }, ...(method === "POST" ? { body: JSON.stringify(value) } : {}) }); }
async function internal(path: string, identity: UserIdentity = actor, method = "GET", value?: unknown) {
  return fetch(loansUrl + path, { method, headers: { Authorization: "Bearer " + await signInternalToken(identity, secret), "Content-Type": "application/json" }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
}
it("uses real HTTP for web→Loans→Equipment and gateway name aggregation, signing only verified claims", async () => {
  const details = await GET(browser("GET"), context()); expect(details.status).toBe(200);
  expect(await details.json()).toMatchObject({ equipment: { name: "Camera", components: [{ name: "Charger" }] }, borrower: { name: "Same-lab borrower" } });
  const response = await POST(browser(), context()); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ loanId, status: "available", isLate: false }); expect(db.state.records).toHaveLength(1);
  expect(observed.length).toBeGreaterThan(5); expect(observed.every(r => r.identity.sub === actorId && r.identity.lab_id === 7 && r.identity.role === "lab_assistant" && r.identity.rid === "return-http" && r.rid === "return-http")).toBe(true);
  expect(receipts).toHaveLength(1); expect(response.headers.get("Cache-Control")).toContain("no-store");
});
it.each(["student", "professor", "lab_manager"] as const)("rejects %s return confirmation and borrower-name access", async role => {
  mocks.profile.mockResolvedValue({ ...profile, role });
  expect((await GET(browser("GET"), context())).status).toBe(403); expect((await POST(browser(), context())).status).toBe(403); expect(mocks.usersQuery).not.toHaveBeenCalled(); expect(mocks.equipmentQuery).not.toHaveBeenCalled();
});
it("rejects other labs, bad IDs and forged browser identity/origin", async () => {
  expect((await internal("/returns/" + loanId, { ...actor, lab_id: 8 })).status).toBe(404);
  expect((await internal("/returns/not-a-uuid")).status).toBe(400);
  const foreign = new Request("http://web.test/api/returns/" + loanId, { method: "POST", headers: { Origin: "http://attacker.test" }, body: JSON.stringify(body) });
  expect((await POST(foreign, context())).status).toBe(403); expect(db.state.records).toHaveLength(0);
});
it("fails closed before HTTP when the verified web session or lab is absent", async () => {
  mocks.profile.mockRejectedValueOnce(new AuthorizationError(401, "unauthenticated", "Sign in is required."));
  expect((await GET(browser("GET"), context())).status).toBe(401);
  mocks.profile.mockResolvedValueOnce({ ...profile, lab_id: null });
  expect((await GET(browser("GET"), context())).status).toBe(403); expect(observed).toHaveLength(0);
});
it("rejects missing, invalid, expired and service tokens through actual business handlers", async () => {
  const expired = await new SignJWT({ ...actor, kind: undefined }).setProtectedHeader({ alg: "HS256" }).setIssuer("unitrack-gateway").setIssuedAt(Math.floor(Date.now() / 1000) - 120).setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(new TextEncoder().encode(secret));
  for (const token of [undefined, "malformed", expired]) {
    const response = await fetch(loansUrl + "/returns/" + loanId, { headers: token ? { Authorization: "Bearer " + token } : {} }); expect(response.status).toBe(401);
  }
  const service = await signInternalToken({ kind: "service", sub: "gateway", role: "service", lab_id: null, rid: "service" }, secret);
  expect((await fetch(loansUrl + "/returns/" + loanId, { headers: { Authorization: "Bearer " + service } })).status).toBe(403); expect(db.sql).toHaveLength(0);
});
it.each(["missing", "damaged"])("returns %s items to inspection using real handlers", async conditionStatus => {
  const response = await POST(browser("POST", { conditions: [{ kitComponentId: null, conditionStatus }] }), context()); expect(response.status).toBe(200); expect((await response.json()).status).toBe("inspection_required"); expect(status).toBe("inspection_required");
});
it("requires the full pickup checklist and records a missing component for inspection", async () => {
  const componentId = "550e8400-e29b-41d4-a716-446655440004";
  db.state.pickup.push({ id: "pickup-charger", kit_component_id: componentId, condition_status: "good", notes: null });
  expect((await POST(browser(), context())).status).toBe(409); expect(receipts).toHaveLength(0);
  const response = await POST(browser("POST", { conditions: [...body.conditions, { kitComponentId: componentId, conditionStatus: "missing" }] }), context());
  expect(response.status).toBe(200); expect((await response.json()).status).toBe("inspection_required"); expect(db.state.records).toHaveLength(2);
});
it("keeps duplicate and concurrent HTTP requests from adding another return", async () => {
  const results = await Promise.all([POST(browser(), context()), POST(browser(), context())]); expect(results.some(r => r.status === 200)).toBe(true);
  expect((await POST(browser(), context())).status).toBe(200); expect(db.state.records).toHaveLength(1); expect(receipts).toHaveLength(1);
  const mismatch = await POST(browser("POST", { conditions: [{ kitComponentId: null, conditionStatus: "damaged" }] }), context()); expect(mismatch.status).toBe(409);
});
it("recovers a lost Equipment response through durable receipt replay", async () => {
  loseEquipmentResponse = true; expect((await POST(browser(), context())).status).toBe(503); expect(status).toBe("available"); expect(db.state.records).toHaveLength(0);
  expect((await POST(browser(), context())).status).toBe(200); expect(receipts).toHaveLength(1); expect(db.state.records).toHaveLength(1);
  const keys = observed.filter(r => r.key).map(r => r.key); expect(keys[0]).toBe(keys[1]);
});
it("times out a stalled Equipment response BODY at three seconds and safely retries", async () => {
  stallEquipmentBody = true;
  const start = Date.now(); const response = await POST(browser(), context()); const elapsed = Date.now() - start;
  expect(response.status).toBe(503); expect(elapsed).toBeGreaterThanOrEqual(2800); expect(elapsed).toBeLessThan(4800);
  expect(status).toBe("available"); expect(db.state.records).toHaveLength(0);
  expect((await POST(browser(), context())).status).toBe(200); expect(receipts).toHaveLength(1);
}, 8000);
it("sanitizes Equipment failures and preserves local state", async () => {
  failEquipment = true; const response = await POST(browser(), context()); expect(response.status).toBe(503); expect(await response.text()).not.toContain(secret); expect(db.state.records).toHaveLength(0); expect(status).toBe("checked_out");
});
it("fails closed before Equipment mutation when operation tracking schema is missing", async () => {
  missingOwnerSchema = true; const response = await POST(browser(), context());
  expect(response.status).toBe(503); expect(await response.text()).not.toContain(secret);
  expect(status).toBe("checked_out"); expect(receipts).toHaveLength(0); expect(db.state.records).toHaveLength(0);
  missingOwnerSchema = false; expect((await POST(browser(), context())).status).toBe(200); expect(receipts).toHaveLength(1);
});
it("compensates a confirmed local rollback through Equipment HTTP", async () => {
  db.settings.historyFailure = true; const response = await POST(browser(), context()); expect(response.status).toBe(503); expect(status).toBe("checked_out"); expect(db.state.loan.returned_at).toBeNull(); expect(receipts).toHaveLength(2);
});
it("keeps compensation conflicts uncertain without overwriting the conflicting status", async () => {
  db.settings.historyFailure = true; undoConflict = true; const response = await POST(browser(), context()); expect(response.status).toBe(503); expect((await response.json()).code).toBe("return_state_uncertain"); expect(status).toBe("under_maintenance"); expect(db.state.loan.return_operation).toMatchObject({ state: "compensating" });
});
it("refuses resumed undo after another real Equipment action restores the same status", async () => {
  db.settings.historyFailure = true; undoConflict = true;
  expect((await POST(browser(), context())).status).toBe(503); expect(status).toBe("under_maintenance");
  undoConflict = false;
  const other = await fetch(equipmentUrl + "/items/" + itemId + "/status", { method: "PATCH", headers: { Authorization: "Bearer " + await signInternalToken(actor, secret), "Content-Type": "application/json", "Idempotency-Key": "other:completed-action" }, body: JSON.stringify({ status: "available", expectedStatus: "under_maintenance" }) });
  expect(other.status).toBe(200); expect(status).toBe("available");
  const retry = await POST(browser(), context()); expect(retry.status).toBe(503);
  expect((await retry.json()).code).toBe("return_state_uncertain"); expect(status).toBe("available"); expect(receipts).toHaveLength(2); expect(db.state.records).toHaveLength(0);
});
it("retries a lost compensation response with the same undo key and never reuses an old apply receipt", async () => {
  db.settings.historyFailure = true; loseUndoResponse = true;
  expect((await POST(browser(), context())).status).toBe(503); expect(status).toBe("checked_out");
  db.settings.historyFailure = false; expect((await POST(browser(), context())).status).toBe(503); expect(db.state.loan.return_operation).toMatchObject({ state: "compensated" });
  expect((await POST(browser(), context())).status).toBe(200); expect(receipts).toHaveLength(3); expect(db.state.records).toHaveLength(1);
});
it.each(["before", "after"] as const)("safely retries uncertain database COMMIT (%s) without compensation", async mode => {
  db.settings.commitFailure = mode; expect((await POST(browser(), context())).status).toBe(503); expect(status).toBe("available"); expect(receipts).toHaveLength(1);
  expect((await POST(browser(), context())).status).toBe(200); expect(db.state.records).toHaveLength(1); expect(receipts).toHaveLength(1);
});
it("provides only item/due-date pairs to students, bounded and lab scoped", async () => {
  const result = await internal("/loans/due-dates?itemIds=" + itemId, { ...actor, role: "student" }); expect(await result.json()).toEqual([{ itemId, dueDate: "2100-01-01T00:00:00.000Z" }]);
  expect(await (await internal("/loans/due-dates?itemIds=" + itemId, { ...actor, lab_id: 8 })).json()).toEqual([]);
  expect((await internal("/loans/due-dates?itemIds=" + Array(101).fill(itemId).join(","))).status).toBe(400);
  expect((await internal("/loans/due-dates?itemIds=invalid")).status).toBe(400);
});
it("rejects invalid conditions and reports missing configuration/schema without leaking details", async () => {
  const invalid = await POST(browser("POST", { conditions: [{ kitComponentId: "not-a-uuid", conditionStatus: "good" }] }), context()); expect(invalid.status).toBe(400); expect(db.state.records).toHaveLength(0);
  vi.stubEnv("INTERNAL_JWT_SECRET", ""); expect((await internal("/returns/" + loanId)).status).toBe(503);
  vi.stubEnv("INTERNAL_JWT_SECRET", secret);
  mocks.loans = { query: async () => { throw Object.assign(new Error(secret + " private schema text"), { code: "42703" }); } };
  const schema = await GET(browser("GET"), context()); expect(schema.status).toBe(503); const data = await schema.text(); expect(data).toContain("configuration or schema"); expect(data).not.toContain(secret); expect(data).not.toContain("private schema");
});
it("restores catalogue dates and preserves items with an explicit partial indication on Loans failure", async () => {
  const request = () => new Request("http://web.test/api/items");
  const full = await catalogue(request()); expect(full.status).toBe(200); expect((await full.json())[0].expectedReturn).toBe("2100-01-01T00:00:00.000Z"); expect(full.headers.has("X-UniTrack-Partial-Data")).toBe(false);
  failDue = true; const partial = await catalogue(request()); expect(partial.status).toBe(200); expect((await partial.json())[0]).toMatchObject({ id: itemId, name: "Camera", expectedReturn: null }); expect(partial.headers.get("X-UniTrack-Partial-Data")).toBe("loans-due-dates");
});
