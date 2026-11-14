import { EquipmentConfigurationError } from "../lib/service-errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signInternalToken } from "@unitrack/internal-auth";
vi.mock("server-only", () => ({}));
const { query, connect } = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock("../lib/db", () => ({ pool: { query }, getDatabasePool: () => ({ query, connect }) }));
import { GET as catalogue, POST as create } from "../app/items/route";
import { GET as categories, POST as addCategory } from "../app/categories/route";
import { GET as manager } from "../app/manager/equipment/route";
import { GET as item, PATCH as edit } from "../app/items/[id]/route";
import { PATCH as status } from "../app/items/[id]/status/route";
import { GET as batch } from "../app/items/batch/route";
import { GET as availability } from "../app/items/[id]/availability/route";
import { GET as components } from "../app/items/[id]/components/route";
const secret = "public-dummy-equipment-secret-not-for-deployment";
const id = "550e8400-e29b-41d4-a716-446655440000";
const context = { params: Promise.resolve({ id }) };
const student = { kind: "user", sub: "profile-1", role: "student", lab_id: 7, rid: "request-1" } as const;
function req(path = "/items", method = "GET", token?: string, body?: unknown) {
 return new Request("http://equipment.test" + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const endpoints = [
 ["catalogue", (r: Request) => catalogue(r)], ["create", (r: Request) => create(r)],
 ["categories", (r: Request) => categories(r)], ["addCategory", (r: Request) => addCategory(r)],
 ["manager", (r: Request) => manager(r)], ["item", (r: Request) => item(r, context)],
 ["edit", (r: Request) => edit(r, context)], ["status", (r: Request) => status(r, context)],
 ["batch", (r: Request) => batch(r)], ["availability", (r: Request) => availability(r, context)], ["components", (r: Request) => components(r, context)],
] as const;
beforeEach(() => { vi.stubEnv("INTERNAL_JWT_SECRET", secret); query.mockReset(); connect.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("Equipment business authentication", () => {
 it.each(endpoints)("requires a verified token before %s", async (_name, handle) => {
   expect((await handle(req())).status).toBe(401);
   expect((await handle(req("/items", "GET", "invalid"))).status).toBe(401);
   expect(query).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled();
 });
 it("rejects expired and wrongly signed tokens", async () => {
   vi.useFakeTimers(); const token = await signInternalToken(student, secret); vi.advanceTimersByTime(60000);
   expect((await catalogue(req("/items", "GET", token))).status).toBe(401);
   vi.useRealTimers(); expect((await catalogue(req("/items", "GET", await signInternalToken(student, "wrong-public-dummy-secret")))).status).toBe(401);
 });
 it("refuses valid service identities on user endpoints", async () => {
   const token = await signInternalToken({ kind: "service", sub: "gateway", role: "service", lab_id: null, rid: "service-1" }, secret);
   expect((await catalogue(req("/items", "GET", token))).status).toBe(403);
 });
 it("refuses students on mutation/staff endpoints", async () => {
   const token = await signInternalToken(student, secret);
   for (const handle of [create, addCategory, manager, (r: Request) => edit(r, context), (r: Request) => status(r, context), (r: Request) => components(r, context)]) expect((await handle(req("/items", "GET", token))).status).toBe(403);
   expect(query).not.toHaveBeenCalled();
 });
 it("scopes reads by signed lab and hides cross-lab IDs", async () => {
   const token = await signInternalToken(student, secret); query.mockResolvedValue({ rows: [] });
   const response = await item(req("/items/" + id + "?lab_id=999", "GET", token), context);
   expect(response.status).toBe(404); expect(query.mock.calls[0][1]).toEqual([[id], 7]);
 });
 it("enforces batch maximum before querying, including duplicate IDs", async () => {
   const token = await signInternalToken(student, secret);
   expect((await batch(req("/items/batch?ids=" + Array(101).fill(id).join(","), "GET", token))).status).toBe(400);
   expect(query).not.toHaveBeenCalled();
 });
 it("deduplicates a valid batch and uses signed lab", async () => {
   const token = await signInternalToken(student, secret); query.mockResolvedValue({ rows: [{ id, name: "scope" }] });
   const response = await batch(req("/items/batch?ids=" + id + "," + id, "GET", token));
   expect(response.status).toBe(200); expect(await response.json()).toEqual([{ id, name: "scope" }]);
   expect(query.mock.calls[0][1]).toEqual([[id], 7]);
 });
 it("returns availability from Equipment state only", async () => {
   const token = await signInternalToken(student, secret); query.mockResolvedValue({ rows: [{ id, status: "available" }] });
   expect(await (await availability(req("/items/" + id + "/availability", "GET", token), context)).json()).toEqual({ reservable: true, status: "available" });
   query.mockResolvedValue({ rows: [{ id, status: "inspection_required" }] });
   expect((await (await availability(req("/items/" + id + "/availability", "GET", token), context)).json()).reservable).toBe(false);
 });
 it("looks up components only after checking item/lab, then scopes component SQL", async () => {
   const token = await signInternalToken({ ...student, role: "lab_assistant" }, secret);
   query.mockResolvedValueOnce({ rows: [{ id, lab_id: 7 }] }).mockResolvedValueOnce({ rows: [{ id: "component", component_name: "Cable" }] });
   const response = await components(req("/items/" + id + "/components", "GET", token), context);
   expect(await response.json()).toEqual([{ id: "component", component_name: "Cable" }]);
   expect(query.mock.calls[1][0]).toContain("c.lab_id = $2"); expect(query.mock.calls[1][1]).toEqual([id, 7]);
 });
});

describe("sanitized Equipment readiness failures", () => {
 it.each(endpoints)("reports missing schema through the actual %s handler", async (name, handle) => {
   const token = await signInternalToken({ ...student, role: "lab_manager" }, secret);
   const error = Object.assign(new Error("private SQL and credential detail"), { code: "42703" });
   query.mockRejectedValue(error); connect.mockRejectedValue(error);
   const method = ["create", "addCategory"].includes(name) ? "POST" : ["edit", "status"].includes(name) ? "PATCH" : "GET";
   const body = method === "GET" ? undefined : { name: "Camera", asset_code: "CAM-1", category_id: 1, condition: "good", is_restricted: false, status: "checked_out" };
   const response = await handle(req("/items?ids=" + id, method, token, body));
   expect(response.status).toBe(503);
   expect(await response.json()).toEqual({ error: "Equipment database schema is not ready.", code: "equipment_schema_not_ready" });
 });
 it.each([
   ["42P01", "equipment_schema_not_ready"], ["28P01", "equipment_database_access"],
   ["42501", "equipment_database_access"], ["ECONNREFUSED", "equipment_database_unavailable"],
 ])("sanitizes database error %s", async (code, expected) => {
   query.mockRejectedValue(Object.assign(new Error(secret + " private connection detail"), { code }));
   const response = await catalogue(req("/items", "GET", await signInternalToken(student, secret)));
   expect(response.status).toBe(503);
   const body = await response.json(); expect(body.code).toBe(expected); expect(body.error).not.toContain(secret);
 });
 it("distinguishes missing database configuration from domain failures", async () => {
   query.mockRejectedValue(new EquipmentConfigurationError("database"));
   const response = await catalogue(req("/items", "GET", await signInternalToken(student, secret)));
   expect(response.status).toBe(503);
   expect(await response.json()).toEqual({ error: "Equipment database is not configured.", code: "equipment_not_configured" });
 });
 it("reports missing signing configuration without accepting a token", async () => {
   const token = await signInternalToken(student, secret); vi.stubEnv("INTERNAL_JWT_SECRET", "");
   expect((await catalogue(req())).status).toBe(401);
   const response = await catalogue(req("/items", "GET", token)); expect(response.status).toBe(503);
   expect(await response.json()).toEqual({ error: "Equipment authentication is not configured.", code: "equipment_not_configured" });
   expect(query).not.toHaveBeenCalled();
 });
});
