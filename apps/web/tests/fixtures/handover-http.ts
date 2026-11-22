// S2-09 handover fixture: actual Web gateway, Loans, Equipment and Users route
// handlers over localhost HTTP with real internal JWT signing/verification.
// ONLY the three databases and the Supabase profile bootstrap are modeled.
// Synthetic data only; this file executes NO SQL and contacts no Supabase.
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { transferableAbortController } from "node:util";
import { webcrypto } from "node:crypto";
import { signInternalToken, verifyInternalToken } from "@unitrack/internal-auth";
import type { InternalIdentity, UserIdentity } from "@unitrack/contracts";
import { handoverDatabase, reservationId, kitItemId, assistantId, borrowerId, kitComponents } from "../../../../services/loans/tests/fixtures/handover-db";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ loans: null as unknown, equipmentQuery: vi.fn(), usersQuery: vi.fn(), profile: vi.fn() }));
vi.mock("../../../../services/loans/lib/db", () => ({ getDatabasePool: () => mocks.loans }));
vi.mock("../../../../services/equipment/lib/db", () => ({ getDatabasePool: () => ({ query: mocks.equipmentQuery, connect: async () => ({ query: mocks.equipmentQuery, release() {} }) }) }));
vi.mock("../../../../services/users/lib/db", () => ({ getDatabasePool: () => ({ query: mocks.usersQuery }) }));
vi.mock("@/lib/auth/authorization", () => ({ getAuthenticatedProfile: mocks.profile }));

import { GET, POST } from "@/app/api/handover/[reservationId]/route";
import { POST as RECOVER } from "@/app/api/handover/[reservationId]/recover/route";
import { GET as LIST } from "@/app/api/handover/route";

const nativeFetch = globalThis.fetch.bind(globalThis);
const root = fileURLToPath(new NodeURL("../../../../services/", import.meta.url)).replaceAll("\\", "/");
export const secret = "public-dummy-handover-http-secret-not-for-deployment";
export const assistant = { id: assistantId, full_name: "Fixture Assistant", university_email: "assistant@mail.aub.edu", role: "lab_assistant", lab_id: 7, is_active: true };
export const borrowerName = "Fixture Student";
export interface StatusHistory { old_status: string; new_status: string; changed_by: unknown; request_key: unknown; reason: unknown }
const componentRows = () => kitComponents.map(c => ({ id: c.id, component_name: c.name, quantity_required: 1, tracked_item_id: null, is_required: c.isRequired, is_active: c.isActive }));

export const fixture = {
  db: handoverDatabase(), status: "reserved", owner: null as string | null, history: [] as StatusHistory[],
  components: componentRows(), itemName: "Five-component camera kit",
  requests: [] as { service: string; method: string; path: string; identity?: InternalIdentity }[],
  failEquipmentStatus: false, loseApplyResponse: false, failComponents: false,
  borrowerActive: true, borrowerRole: "student", borrowerLab: 7, usersDown: false, usersDownAfterCheckout: false,
  asRole(role: string) { mocks.profile.mockResolvedValue({ ...assistant, role }); },
  get profile() { return mocks.profile; },
  get equipmentQuery() { return mocks.equipmentQuery; },
  browser(method: "GET" | "POST", body?: unknown, headers: Record<string, string> = {}) {
    return new Request("http://web.test/api/handover/" + reservationId, { method, headers: { "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  },
  context: (id = reservationId) => ({ params: Promise.resolve({ reservationId: id }) }),
  async direct(path: string, identity: UserIdentity | null, method = "GET", body?: unknown) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (identity) headers.Authorization = "Bearer " + await signInternalToken(identity, secret);
    return nativeFetch(loansUrl + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  },
};
/** Actual Web gateway route handlers (imported after the mocks above). */
export const routes = { GET: (...args: Parameters<typeof GET>) => GET(...args), POST: (...args: Parameters<typeof POST>) => POST(...args), RECOVER: (...args: Parameters<typeof RECOVER>) => RECOVER(...args), LIST: (...args: Parameters<typeof LIST>) => LIST(...args) };

const servers: Server[] = [];
let loansUrl: string, equipmentUrl: string, usersUrl: string;
async function serve(dispatch: (req: Request) => Promise<Response>, service: string) {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const headers = new Headers(); for (const [key, value] of Object.entries(incoming.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
      const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const req = new Request("http://127.0.0.1" + incoming.url, { method: incoming.method, headers, ...(incoming.method === "GET" ? {} : { body: Buffer.concat(chunks).toString() }) });
      let identity: InternalIdentity | undefined;
      try { identity = await verifyInternalToken(headers.get("authorization")?.slice(7), secret); } catch { /* Real handler rejects it. */ }
      fixture.requests.push({ service, method: req.method, path: new NodeURL(req.url).pathname, identity });
      if (service === "equipment" && req.method === "PATCH" && fixture.failEquipmentStatus) { outgoing.writeHead(503, { "Content-Type": "application/json" }); outgoing.end(JSON.stringify({ error: secret + " raw upstream detail" })); return; }
      if (service === "users" && fixture.usersDown && req.url.endsWith("/borrower")) { outgoing.writeHead(503, { "Content-Type": "application/json" }); outgoing.end('{"error":"Users service is not configured."}'); return; }
      if (service === "equipment" && fixture.failComponents && req.url.endsWith("/components")) { outgoing.writeHead(503, { "Content-Type": "application/json" }); outgoing.end('{"error":"Equipment database is unavailable."}'); return; }
      const response = await dispatch(req);
      // Drop the TCP response AFTER the real Equipment handler committed.
      if (service === "equipment" && req.method === "PATCH" && fixture.usersDownAfterCheckout) fixture.usersDown = true;
      if (service === "equipment" && req.method === "PATCH" && fixture.loseApplyResponse) { fixture.loseApplyResponse = false; incoming.socket.destroy(); return; }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries())); outgoing.end(await response.text());
    } catch { outgoing.writeHead(500, { "Content-Type": "application/json" }); outgoing.end('{"error":"Isolated handover fixture failed."}'); }
  });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture unavailable");
  return "http://127.0.0.1:" + address.port;
}

beforeAll(async () => {
  const handover = await import(root + "loans/app/handover/[reservationId]/route.ts");
  const item = await import(root + "equipment/app/items/[id]/route.ts");
  const change = await import(root + "equipment/app/items/[id]/status/route.ts");
  const componentRoute = await import(root + "equipment/app/items/[id]/components/route.ts");
  const names = await import(root + "users/app/profiles/batch/route.ts");
  const borrowerRoute = await import(root + "users/app/profiles/[id]/borrower/route.ts");
  const handoverList = await import(root + "loans/app/handover/route.ts");
  const handoverRecover = await import(root + "loans/app/handover/[reservationId]/recover/route.ts");
  loansUrl = await serve(req => {
    const context = { params: Promise.resolve({ reservationId: decodeURIComponent(new NodeURL(req.url).pathname.split("/")[2] ?? "") }) };
    const parts = new NodeURL(req.url).pathname.split("/");
    if (parts.length === 2) return handoverList.GET(req);
    if (parts[3] === "recover") return handoverRecover.POST(req, context);
    return req.method === "POST" ? handover.POST(req, context) : handover.GET(req, context);
  }, "loans");
  equipmentUrl = await serve(req => {
    const context = { params: Promise.resolve({ id: decodeURIComponent(new NodeURL(req.url).pathname.split("/")[2] ?? "") }) };
    return req.url.endsWith("/status") ? change.PATCH(req, context) : req.url.endsWith("/components") ? componentRoute.GET(req, context) : item.GET(req, context);
  }, "equipment");
  usersUrl = await serve(req => req.url.endsWith("/borrower") ? borrowerRoute.GET(req, { params: Promise.resolve({ id: decodeURIComponent(new NodeURL(req.url).pathname.split("/")[2] ?? "") }) }) : names.GET(req), "users");
});
afterAll(async () => { for (const server of servers) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } });

beforeEach(() => {
  // jsdom realm adapters (same as the return acceptance fixture); harmless in node.
  vi.stubGlobal("AbortController", transferableAbortController().constructor);
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("Uint8Array", Object.getPrototypeOf(Buffer));
  fixture.db = handoverDatabase(); mocks.loans = fixture.db.pool;
  fixture.status = "reserved"; fixture.owner = null; fixture.history = []; fixture.components = componentRows(); fixture.requests = [];
  fixture.failEquipmentStatus = false; fixture.loseApplyResponse = false; fixture.failComponents = false;
  fixture.borrowerActive = true; fixture.borrowerRole = "student"; fixture.borrowerLab = 7; fixture.usersDown = false; fixture.usersDownAfterCheckout = false;
  vi.stubEnv("INTERNAL_JWT_SECRET", secret); vi.stubEnv("LOANS_SERVICE_URL", loansUrl); vi.stubEnv("EQUIPMENT_SERVICE_URL", equipmentUrl); vi.stubEnv("USERS_SERVICE_URL", usersUrl);
  mocks.profile.mockReset().mockResolvedValue(assistant);
  // Users' profiles table: the signed-in assistant and the reservation's borrower.
  mocks.usersQuery.mockReset().mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("ANY(")) return { rows: [{ id: borrowerId, full_name: borrowerName }] };
    if (values[0] === borrowerId) return { rows: [{ id: borrowerId, full_name: borrowerName, university_email: "student@mail.aub.edu", role: fixture.borrowerRole, lab_id: fixture.borrowerLab, is_active: fixture.borrowerActive }] };
    return { rows: [assistant] };
  });
  let snapshot: { status: string; owner: string | null; history: StatusHistory[] };
  // Models Equipment's tables for its real handlers and status transaction.
  mocks.equipmentQuery.mockReset().mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql === "BEGIN") snapshot = { status: fixture.status, owner: fixture.owner, history: structuredClone(fixture.history) };
    if (sql === "ROLLBACK") { fixture.status = snapshot.status; fixture.owner = snapshot.owner; fixture.history = snapshot.history; }
    if (sql.includes("FOR UPDATE")) return { rows: values[0] === kitItemId && values[1] === 7 ? [{ id: kitItemId, lab_id: 7, status: fixture.status, status_request_key: fixture.owner }] : [] };
    if (sql.includes("FROM public.equipment_status_history")) return { rows: fixture.history.filter(h => h.request_key === values[0]) };
    if (sql.startsWith("UPDATE public.equipment_items")) { fixture.status = String(values[0]); fixture.owner = null; }
    if (sql.includes("INSERT INTO public.equipment_status_history")) { fixture.owner = String(values[6]); fixture.history.push({ old_status: String(values[2]), new_status: String(values[3]), changed_by: values[4], reason: values[5], request_key: values[6], request_fingerprint: values[7] } as StatusHistory); }
    if (sql.includes("FROM public.kit_components")) return { rows: fixture.components };
    if (sql.includes("FROM public.equipment_items") && sql.includes("ANY(")) return { rows: values[1] === 7 && (values[0] as string[]).includes(kitItemId) ? [{ id: kitItemId, asset_code: "KIT-HO-1", name: fixture.itemName, status: fixture.status, lab_id: 7, condition: "good", is_restricted: false }] : [] };
    return { rows: [] };
  });
  // Only the same-origin browser transport is adapted; service calls use real TCP.
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (input === "/api/handover") return LIST(new Request("http://web.test/api/handover", init));
    if (typeof input === "string" && /^\/api\/handover\/[^/]+\/recover$/.test(input)) {
      const request = new Request("http://web.test" + input, init);
      return RECOVER(request, fixture.context(decodeURIComponent(input.split("/")[3])));
    }
    if (typeof input === "string" && input.startsWith("/api/handover/")) {
      const request = new Request("http://web.test" + input, init);
      const context = fixture.context(decodeURIComponent(new NodeURL(request.url).pathname.split("/")[3] ?? ""));
      return request.method === "POST" ? POST(request, context) : GET(request, context);
    }
    if (typeof input === "string" && input.startsWith("/")) throw new Error("Unexpected browser fixture route");
    return nativeFetch(input, init);
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
