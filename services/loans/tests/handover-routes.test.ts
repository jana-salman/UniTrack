// S2-09: Loans handover route handlers and the Loans->Equipment adapter boundary.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signInternalToken } from "@unitrack/internal-auth";
import type { UserIdentity } from "@unitrack/contracts";
import { handoverDatabase, goodChecklist, checklistVersionFor, reservationId, kitItemId, assistantId, borrowerId, labId, kitComponents } from "./fixtures/handover-db";
vi.mock("server-only", () => ({}));
const holder = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock("../lib/db", () => ({ getDatabasePool: () => holder.pool }));
import { GET, POST } from "../app/handover/[reservationId]/route";
import { POST as RECOVER } from "../app/handover/[reservationId]/recover/route";
import { GET as LIST } from "../app/handover/route";
import { usersHttp } from "../lib/users-http";
import { handoverEquipmentHttp, equipmentHttp } from "../lib/equipment-http";

const secret = "public-dummy-handover-route-secret-not-for-deployment";
const assistant: UserIdentity = { kind: "user", sub: assistantId, role: "lab_assistant", lab_id: labId, rid: "handover-route" };
let db: ReturnType<typeof handoverDatabase>;
let equipmentStatus: string;
let borrowerResponse: () => Response;
const fetchCalls: { url: string; method: string; key: string | null; body: unknown }[] = [];
beforeEach(() => {
  db = handoverDatabase(); holder.pool = db.pool; equipmentStatus = "reserved"; fetchCalls.length = 0;
  borrowerResponse = () => Response.json({ id: borrowerId, full_name: "Fixture Student", role: "student", is_active: true });
  vi.stubEnv("INTERNAL_JWT_SECRET", secret); vi.stubEnv("EQUIPMENT_SERVICE_URL", "http://equipment.test"); vi.stubEnv("USERS_SERVICE_URL", "http://users.test");
  // Equipment over fetch: item, components and keyed status change wire shapes.
  vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    fetchCalls.push({ url: path, method: String(init.method), key: new Headers(init.headers).get("Idempotency-Key"), body });
    if (new URL(url).host === "users.test") return borrowerResponse();
    if (path.endsWith("/components")) return Response.json(kitComponents.map(c => ({ id: c.id, component_name: c.name, quantity_required: 1, tracked_item_id: null, is_required: c.isRequired, is_active: c.isActive })));
    if (path.endsWith("/status")) { equipmentStatus = body.status; return Response.json({ itemId: kitItemId, status: body.status, changed: true }); }
    return Response.json({ id: kitItemId, asset_code: "KIT-1", name: "Camera kit", status: equipmentStatus, lab_id: labId, condition: "good", is_restricted: false });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const context = (id = reservationId) => ({ params: Promise.resolve({ reservationId: id }) });
const valid = () => ({ studentConfirmed: true, checklistVersion: checklistVersionFor(kitItemId, kitComponents), conditions: goodChecklist() });
async function request(method: "GET" | "POST", identity: UserIdentity | null = assistant, value?: unknown, id = reservationId) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (identity) headers.Authorization = "Bearer " + await signInternalToken(identity, secret);
  return new Request("http://loans.test/handover/" + id, { method, headers, ...(value === undefined ? {} : { body: typeof value === "string" ? value : JSON.stringify(value) }) });
}

describe("Loans /handover/:reservationId", () => {
  it("completes a confirmed kit handover through the real route and Equipment wire contract", async () => {
    const response = await POST(await request("POST", assistant, valid()), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ reservationId, status: "checked_out" });
    const patch = fetchCalls.find(c => c.method === "PATCH");
    expect(patch).toMatchObject({ url: "/items/" + kitItemId + "/status", key: expect.stringMatching(/^handover:.+:0:apply$/), body: { status: "checked_out", expectedStatus: ["reserved"], trackOperation: true } });
    const details = await (await GET(await request("GET"), context())).json();
    expect(details.handover.pickupConditions).toHaveLength(6);
    expect(JSON.stringify(details)).not.toMatch(/fingerprint|handover_operation|:apply/);
  });
  it.each([null, { ...assistant, role: "student" }, { ...assistant, role: "professor" }, { ...assistant, role: "lab_manager" }] as const)("denies %o on GET and POST without database access", async identity => {
    const expected = identity ? 403 : 401;
    expect((await GET(await request("GET", identity as UserIdentity | null), context())).status).toBe(expected);
    expect((await POST(await request("POST", identity as UserIdentity | null, valid()), context())).status).toBe(expected);
    expect(db.sql).toHaveLength(0); expect(fetchCalls).toHaveLength(0);
    expect((await RECOVER(await request("POST", identity as UserIdentity | null), context())).status).toBe(expected);
    expect((await LIST(await request("GET", identity as UserIdentity | null))).status).toBe(expected);
  });
  it("rejects a service identity", async () => {
    const service = await signInternalToken({ kind: "service", sub: "gateway", role: "service", lab_id: null, rid: "svc" }, secret);
    const response = await GET(new Request("http://loans.test/handover/" + reservationId, { headers: { Authorization: "Bearer " + service } }), context());
    expect(response.status).toBe(403);
  });
  it("validates IDs and bodies, and returns 404 for other labs", async () => {
    expect((await GET(await request("GET", assistant, undefined, "not-a-uuid"), context("not-a-uuid"))).status).toBe(400);
    expect((await POST(await request("POST", assistant, "{bad json"), context())).status).toBe(400);
    expect((await GET(await request("GET", { ...assistant, lab_id: 8 }), context())).status).toBe(404);
  });
  it("TC-3.7: an unconfirmed POST is rejected with 400 and nothing reaches the database or Equipment", async () => {
    const response = await POST(await request("POST", assistant, { ...valid(), studentConfirmed: false }), context());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "The student must confirm the handover before it can be completed.", code: "student_confirmation_required" });
    expect(db.sql).toHaveLength(0); expect(fetchCalls).toHaveLength(0); expect(equipmentStatus).toBe("reserved");
  });
  it("reports Equipment outage as uncertain without a loan, then completes on retry", async () => {
    const base = vi.mocked(fetch).getMockImplementation()!;
    let equipmentDown = true;
    vi.mocked(fetch).mockImplementation(async (url, init) => equipmentDown && new URL(String(url)).host === "equipment.test" ? new Response("down", { status: 503 }) : base(url, init!));
    const failed = await POST(await request("POST", assistant, valid()), context());
    expect(failed.status).toBe(503); expect((await failed.json()).code).toBe("handover_state_uncertain");
    equipmentDown = false;
    expect(db.state.loans).toHaveLength(0);
    expect((await POST(await request("POST", assistant, valid()), context())).status).toBe(200);
  });
});

describe("Loans recovery and interrupted list routes", () => {
  it("lists an interrupted handover and finishes it through /recover without any checklist in the request", async () => {
    let usersUp = true;
    borrowerResponse = () => usersUp ? Response.json({ id: borrowerId, full_name: "Fixture Student", role: "student", is_active: true }) : new Response("down", { status: 503 });
    const base = vi.mocked(fetch).getMockImplementation()!;
    // Users goes down right after checkout: durable 'applied' plan, honest 503.
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const response = await base(url, init!);
      if (new URL(String(url)).pathname.endsWith("/status")) usersUp = false;
      return response;
    });
    const failed = await POST(await request("POST", assistant, valid()), context());
    expect(failed.status).toBe(503); expect((await failed.json()).code).toBe("handover_incomplete");
    expect(equipmentStatus).toBe("checked_out"); expect(db.state.loans).toHaveLength(0);
    const list = await (await LIST(await request("GET"))).json();
    expect(list).toEqual([expect.objectContaining({ reservationId, itemId: kitItemId, state: "applied", recoverableByYou: true })]);
    expect(JSON.stringify(list)).not.toMatch(/fingerprint|conditions|borrower/);
    usersUp = true;
    const recovered = await RECOVER(await request("POST"), context());
    expect(recovered.status).toBe(200); expect(await recovered.json()).toMatchObject({ reservationId, status: "checked_out" });
    expect(db.state.records).toHaveLength(6); expect(await (await LIST(await request("GET"))).json()).toEqual([]);
  });
  it("returns 404 handover_not_pending when there is nothing to recover", async () => {
    const response = await RECOVER(await request("POST"), context());
    expect(response.status).toBe(404); expect((await response.json()).code).toBe("handover_not_pending");
  });
});

describe("Loans -> Users borrower verification adapter", () => {
  const verify = () => usersHttp(assistant).verifyBorrower(borrowerId);
  it("calls only the configured Users origin with a signed assistant token", async () => {
    expect(await verify()).toEqual({ id: borrowerId, fullName: "Fixture Student", role: "student" });
    expect(fetchCalls).toEqual([expect.objectContaining({ url: "/profiles/" + borrowerId + "/borrower", method: "GET" })]);
  });
  it.each([
    ["not found", () => new Response("{}", { status: 404 }), 409, "borrower_unverified"],
    ["inactive", () => Response.json({ id: borrowerId, full_name: "x", role: "student", is_active: false }), 409, "borrower_unverified"],
    ["a different profile", () => Response.json({ id: kitItemId, full_name: "x", role: "student", is_active: true }), 409, "borrower_unverified"],
    ["malformed", () => Response.json({ id: borrowerId }), 503, "borrower_unavailable"],
    ["a 5xx", () => new Response("down", { status: 503 }), 503, "borrower_unavailable"],
    ["non-JSON success", () => new Response("ok", { status: 200 }), 503, "borrower_unavailable"],
    ["rejected staff identity", () => new Response("{}", { status: 403 }), 403, "forbidden"],
  ] as const)("fails closed when Users answers %s", async (_name, response, statusCode, code) => {
    borrowerResponse = response;
    await expect(verify()).rejects.toMatchObject({ status: statusCode, code });
  });
  it("fails closed on network errors and missing configuration", async () => {
    borrowerResponse = () => { throw new TypeError("network down"); };
    await expect(verify()).rejects.toMatchObject({ status: 503, code: "borrower_unavailable" });
    vi.stubEnv("USERS_SERVICE_URL", "");
    await expect(verify()).rejects.toMatchObject({ status: 503, code: "loans_configuration" });
  });
  it("an unconfirmed POST never reaches Users", async () => {
    await POST(await request("POST", assistant, { ...valid(), studentConfirmed: false }), context());
    expect(fetchCalls).toHaveLength(0);
  });
});

describe("handover Equipment adapter", () => {
  it("projects only validated component fields and normalizes IDs", async () => {
    const components = await handoverEquipmentHttp(assistant).getKitComponents(kitItemId, labId);
    expect(components).toEqual(kitComponents.map(c => ({ id: c.id, name: c.name, isActive: true, isRequired: true })));
  });
  it("fails uncertain on a malformed component payload and refuses another lab", async () => {
    vi.mocked(fetch).mockImplementationOnce(async () => Response.json([{ id: kitComponents[0].id, component_name: "Charger" }]));
    await expect(handoverEquipmentHttp(assistant).getKitComponents(kitItemId, labId)).rejects.toMatchObject({ status: 503 });
    await expect(handoverEquipmentHttp(assistant).getKitComponents(kitItemId, 8)).rejects.toMatchObject({ status: 403 });
  });
  it("leaves the return adapter's component contract unchanged", async () => {
    await expect(equipmentHttp(assistant).getComponents(kitItemId, labId)).rejects.toThrow("Components are aggregated by the gateway.");
  });
});
