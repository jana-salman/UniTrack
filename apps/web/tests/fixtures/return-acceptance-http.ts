// Actual route handlers/signing/fetch over localhost; DB and verified profile
// bootstrap are isolated models. This file executes NO SQL or Supabase calls.
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { transferableAbortController } from "node:util";
import { webcrypto } from "node:crypto";
import { signInternalToken, verifyInternalToken } from "@unitrack/internal-auth";
import type { InternalIdentity } from "@unitrack/contracts";
import { returnDatabase, loanId, itemId, actorId, borrowerId } from "../../../../services/loans/tests/fixtures/return-db";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ loans: null as unknown, equipmentQuery: vi.fn(), usersQuery: vi.fn(), profile: vi.fn() }));
vi.mock("../../../../services/loans/lib/db", () => ({ getDatabasePool: () => mocks.loans }));
vi.mock("../../../../services/equipment/lib/db", () => ({ getDatabasePool: () => ({ query: mocks.equipmentQuery, connect: async () => ({ query: mocks.equipmentQuery, release() {} }) }) }));
vi.mock("../../../../services/users/lib/db", () => ({ getDatabasePool: () => ({ query: mocks.usersQuery }) }));
vi.mock("@/lib/auth/authorization", () => ({ getAuthenticatedProfile: mocks.profile }));

import { GET, POST } from "@/app/api/returns/[loanId]/route";
import { GET as catalogue } from "@/app/api/items/route";
import { GET as ownProblems } from "@/app/api/returns/problems/mine/route";

const nativeFetch = globalThis.fetch.bind(globalThis);
const root = fileURLToPath(new NodeURL("../../../../services/", import.meta.url)).replaceAll("\\", "/");
const secret = "public-dummy-return-acceptance-secret-not-for-deployment";
const assistant = { id: actorId, full_name: "Assistant", university_email: "assistant@mail.aub.edu", role: "lab_assistant", lab_id: 7, is_active: true };
export const components = ["Charger", "Cable", "Battery", "Case", "Tripod"].map((name, index) => ({ id: "550e8400-e29b-41d4-a716-44665544002" + index, component_name: name }));
export interface StatusHistory { old_status: string; new_status: string; changed_by: unknown; request_key: unknown; request_fingerprint: unknown; changed_at: Date }
export const fixture = {
  db: returnDatabase(), name: "Five-component camera kit", status: "checked_out", owner: null as string | null,
  history: [] as StatusHistory[], components: [...components],
  requests: [] as { method: string; path: string; identity?: InternalIdentity }[],
  posts: [] as unknown[], loseApplyResponse: false,
  confirmationGate: null as Promise<void> | null,
  labelsUnavailable: false,
  extraPayloadFields: false,
  asStudent(overrides: { id?: string; lab_id?: number } = {}) { mocks.profile.mockResolvedValue({ ...assistant, id: borrowerId, full_name: "Borrower", role: "student", ...overrides }); },
  asAssistant() { mocks.profile.mockResolvedValue(assistant); },
  async readMine(query = "") { return ownProblems(new Request("http://web.test/api/returns/problems/mine" + query, { headers: { "X-Borrower-Id": actorId, "X-Lab-Id": "999" } })); },
  async directMine(identity?: InternalIdentity | string) { const token = typeof identity === "string" ? identity : identity ? await signInternalToken(identity, secret) : undefined; return nativeFetch(loansUrl + "/returns/problems/mine?borrowerId=" + borrowerId, { headers: token ? { Authorization: "Bearer " + token } : {} }); },
  async directLabels(identity?: InternalIdentity | string, staffEndpoint = false) { const token = typeof identity === "string" ? identity : identity ? await signInternalToken(identity, secret) : undefined; return nativeFetch(equipmentUrl + "/items/" + itemId + (staffEndpoint ? "/components" : "/component-labels"), { headers: token ? { Authorization: "Bearer " + token } : {} }); },
  async confirmAgain(body: unknown) { return POST(new Request("http://web.test/api/returns/" + loanId, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ loanId }) }); },
};
const servers: Server[] = [];
let loansUrl: string, equipmentUrl: string, usersUrl: string;

async function serve(dispatch: (req: Request) => Promise<Response>, service: string) {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const headers = new Headers(); for (const [key, value] of Object.entries(incoming.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
      const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const req = new Request("http://127.0.0.1" + incoming.url, { method: incoming.method, headers, ...(incoming.method === "GET" ? {} : { body: Buffer.concat(chunks).toString() }) });
      let identity: InternalIdentity | undefined;
      try { identity = await verifyInternalToken(headers.get("authorization")?.slice(7), secret); }
      catch { /* The actual route handler must reject missing/invalid credentials. */ }
      fixture.requests.push({ method: req.method, path: service + new NodeURL(req.url).pathname, identity });
      if (service === "equipment" && fixture.labelsUnavailable && req.url.endsWith("/component-labels")) { outgoing.writeHead(503, { "Content-Type": "application/json" }); outgoing.end('{"error":"Labels unavailable."}'); return; }
      if (service === "loans" && req.method === "POST" && fixture.confirmationGate) await fixture.confirmationGate;
      const response = await dispatch(req);
      if (service === "equipment" && req.method === "PATCH" && fixture.loseApplyResponse) { fixture.loseApplyResponse = false; incoming.socket.destroy(); return; }
      let body = await response.text();
      if (service === "loans" && response.ok && fixture.extraPayloadFields) {
        const add = (row: Record<string, unknown>): Record<string, unknown> => ({ ...row, return_operation: { state: "unapproved-metadata" }, other_borrower: "unapproved-metadata" });
        const payload = JSON.parse(body);
        if (Array.isArray(payload)) body = JSON.stringify(payload.map(add));
        else {
          const value = add(payload);
          if (payload.loan) value.loan = add(payload.loan);
          if (payload.pickupConditions) value.pickupConditions = payload.pickupConditions.map(add);
          if (payload.returnHistory) value.returnHistory = { ...add(payload.returnHistory), conditions: payload.returnHistory.conditions.map(add) };
          body = JSON.stringify(value);
        }
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries())); outgoing.end(body);
    } catch { outgoing.writeHead(500, { "Content-Type": "application/json" }); outgoing.end('{"error":"Isolated acceptance fixture failed."}'); }
  });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture unavailable");
  return "http://127.0.0.1:" + address.port;
}

beforeAll(async () => {
  const returns = await import(root + "loans/app/returns/[loanId]/route.ts");
  const due = await import(root + "loans/app/loans/due-dates/route.ts");
  const mine = await import(root + "loans/app/returns/problems/mine/route.ts");
  const item = await import(root + "equipment/app/items/[id]/route.ts");
  const change = await import(root + "equipment/app/items/[id]/status/route.ts");
  const componentRoute = await import(root + "equipment/app/items/[id]/components/route.ts");
  const componentLabels = await import(root + "equipment/app/items/[id]/component-labels/route.ts");
  const items = await import(root + "equipment/app/items/route.ts");
  const names = await import(root + "users/app/profiles/batch/route.ts");
  const itemContext = { params: Promise.resolve({ id: itemId }) };
  loansUrl = await serve(req => {
    const context = { params: Promise.resolve({ loanId: decodeURIComponent(new NodeURL(req.url).pathname.split("/")[2] ?? "") }) };
    return new NodeURL(req.url).pathname === "/returns/problems/mine" ? mine.GET(req) : req.url.includes("due-dates") ? due.GET(req) : req.method === "POST" ? returns.POST(req, context) : returns.GET(req, context);
  }, "loans");
  equipmentUrl = await serve(req => new NodeURL(req.url).pathname === "/items" ? items.GET(req) : req.url.endsWith("/component-labels") ? componentLabels.GET(req, itemContext) : req.url.endsWith("/status") ? change.PATCH(req, itemContext) : req.url.endsWith("/components") ? componentRoute.GET(req, itemContext) : item.GET(req, itemContext), "equipment");
  usersUrl = await serve(req => names.GET(req), "users");
});
afterAll(async () => { for (const server of servers) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } });

beforeEach(() => {
  // The services run through Node's native fetch/Request. Use its AbortSignal
  // realm as well; jsdom's signal is not accepted by Node's Request constructor.
  vi.stubGlobal("AbortController", transferableAbortController().constructor);
  vi.stubGlobal("crypto", webcrypto); // jsdom has no SubtleCrypto; verify REAL JWTs.
  vi.stubGlobal("Uint8Array", Object.getPrototypeOf(Buffer)); // TextEncoder/crypto use Node's byte realm.
  fixture.db = returnDatabase(); mocks.loans = fixture.db.pool;
  fixture.name = "Five-component camera kit"; fixture.status = "checked_out"; fixture.owner = null; fixture.history = []; fixture.components = [...components]; fixture.requests = []; fixture.posts = []; fixture.loseApplyResponse = false;
  fixture.confirmationGate = null;
  fixture.labelsUnavailable = false;
  fixture.extraPayloadFields = false;
  fixture.db.state.pickup.push(...components.map((component, index) => ({ id: "550e8400-e29b-41d4-a716-44665544003" + index, kit_component_id: component.id, condition_status: "good" as const, notes: "Checked at handover: " + component.component_name })));
  vi.stubEnv("INTERNAL_JWT_SECRET", secret); vi.stubEnv("LOANS_SERVICE_URL", loansUrl); vi.stubEnv("EQUIPMENT_SERVICE_URL", equipmentUrl); vi.stubEnv("USERS_SERVICE_URL", usersUrl);
  mocks.profile.mockReset().mockResolvedValue(assistant);
  mocks.usersQuery.mockReset().mockImplementation(async (sql: string) => ({ rows: sql.includes("ANY(") ? [{ id: borrowerId, full_name: "Fixture borrower" }] : [assistant] }));
  let snapshot: { status: string; owner: string | null; history: StatusHistory[] };
  mocks.equipmentQuery.mockReset().mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql === "BEGIN") snapshot = { status: fixture.status, owner: fixture.owner, history: structuredClone(fixture.history) };
    if (sql === "ROLLBACK") { fixture.status = snapshot.status; fixture.owner = snapshot.owner; fixture.history = snapshot.history; }
    if (sql.includes('AS "assetCode"')) return { rows: [{ id: itemId, assetCode: "ZZ-ACCEPT-1", name: fixture.name, category: "Acceptance fixture", status: fixture.status, expectedReturn: null }] };
    if (sql.includes("FOR UPDATE")) return { rows: values[1] === 7 ? [{ id: itemId, lab_id: 7, status: fixture.status, status_request_key: fixture.owner }] : [] };
    if (sql.includes("FROM public.equipment_status_history")) return { rows: fixture.history.filter(h => h.request_key === values[0]) };
    if (sql.startsWith("UPDATE public.equipment_items")) { fixture.status = String(values[0]); fixture.owner = null; }
    if (sql.includes("INSERT INTO public.equipment_status_history")) { fixture.owner = String(values[6]); fixture.history.push({ old_status: String(values[2]), new_status: String(values[3]), changed_by: values[4], request_key: values[6], request_fingerprint: values[7], changed_at: new Date() }); }
    if (sql.includes("FROM public.kit_components")) return { rows: fixture.components };
    if (sql.includes("FROM public.equipment_items") && sql.includes("ANY(")) return { rows: values[1] === 7 ? [{ id: itemId, name: fixture.name, lab_id: 7, status: fixture.status }] : [] };
    return { rows: [] };
  });
  // Only the same-origin browser transport is adapted. Internal service calls
  // retain native fetch over real TCP and execute actual authenticated handlers.
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string" && input.startsWith("/api/")) {
      const request = new Request("http://web.test" + input, init);
      if (input.startsWith("/api/returns/problems/mine")) return ownProblems(request);
      if (input.startsWith("/api/returns/")) {
        const context = { params: Promise.resolve({ loanId: decodeURIComponent(new NodeURL(request.url).pathname.split("/")[3] ?? "") }) };
        if (request.method === "POST") { fixture.posts.push(await request.clone().json()); return POST(request, context); }
        return GET(request, context);
      }
      if (input.startsWith("/api/items")) return catalogue(request);
      if (input === "/api/categories") return Response.json([]); // outside these cards
      throw new Error("Unexpected browser fixture route");
    }
    return nativeFetch(input, init);
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
