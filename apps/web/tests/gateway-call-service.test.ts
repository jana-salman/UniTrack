import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyInternalToken } from "@unitrack/internal-auth";
vi.mock("server-only", () => ({}));
import { createServiceCaller, DEVELOPMENT_SERVICE_TIMEOUT_MS, SERVICE_TIMEOUT_MS } from "@/lib/gateway/call-service";
const secret = "public-dummy-gateway-test-secret-not-for-deployment";
const identity = { kind: "user", sub: "trusted-profile", role: "lab_assistant", lab_id: 7, rid: "trusted-request-1" } as const;
const caller = () => createServiceCaller({ baseUrl: "https://equipment.test", secret });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("gateway service caller", () => {
  it("signs trusted identity, forwards tracing and preserves success JSON", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ result: "ok" }, { status: 201 })); vi.stubGlobal("fetch", fetcher);
    const body = { role: "lab_manager", sub: "browser-profile", lab_id: 99, rid: "browser-request" };
    const response = await caller()("/items?limit=1", identity, { method: "POST", body });
    expect(response.status).toBe(201); expect(await response.json()).toEqual({ result: "ok" });
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toBe("https://equipment.test/items?limit=1");
    expect(options.headers["X-Request-Id"]).toBe(identity.rid);
    expect(await verifyInternalToken(options.headers.Authorization.slice(7), secret)).toEqual(identity);
    expect(options).toMatchObject({ method: "POST", body: JSON.stringify(body), redirect: "error", cache: "no-store", credentials: "omit" });
    expect(response.headers.get("X-Request-Id")).toBe(identity.rid);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("allows explicit gateway service identities without treating them as users", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true })); vi.stubGlobal("fetch", fetcher);
    const service = { kind: "service", sub: "gateway", role: "service", lab_id: null, rid: "service-request" } as const;
    await caller()("/profiles/one", service);
    expect(await verifyInternalToken(fetcher.mock.calls[0][1].headers.Authorization.slice(7), secret)).toEqual(service);
  });
  it.each(["https://attacker.test/path", "//attacker.test/path", "/\\attacker.test/path", "/ok#fragment", "/bad\npath"])("rejects destination override %s without fetching", async path => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect((await caller()(path, identity)).status).toBe(500); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["not-a-url", "file:///tmp/file", "https://user:password@example.test", "https://service.test/prefix", "https://service.test?secret=marker"])("sanitizes invalid service configuration", baseUrl => {
    expect(() => createServiceCaller({ baseUrl, secret })).toThrow(/^Invalid service configuration\.$/);
  });
  it("rejects a missing secret or invalid identity before fetching", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect((await createServiceCaller({ baseUrl: "https://equipment.test", secret: "" })("/items", identity)).status).toBe(500);
    expect((await caller()("/items", { ...identity, lab_id: 0 })).status).toBe(500);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504])("preserves upstream HTTP %s without exposing free text or headers", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: secret, code: "private-token-marker" }, { status, headers: { "Set-Cookie": "private-marker", Authorization: "secret-marker" } })));
    const response = await caller()("/items", identity);
    expect(response.status).toBe(status); expect(await response.json()).toMatchObject({ code: "upstream_" + status });
    expect(response.headers.has("Set-Cookie")).toBe(false); expect(response.headers.has("Authorization")).toBe(false);
  });
  it("preserves approved field errors and strips unrelated error fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Name is required.", errors: ["Name is required."], code: "invalid_input", debug: "not-public" }, { status: 400 })));
    const call = createServiceCaller({ baseUrl: "https://equipment.test", secret, errorContract: { messages: ["Name is required."], codes: ["invalid_input"] } });
    const response = await call("/items", identity);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Name is required.", errors: ["Name is required."], code: "invalid_input" });
  });
  it("does not relay unapproved or credential-bearing domain error fields", async () => {
    const call = createServiceCaller({ baseUrl: "https://equipment.test", secret, errorContract: { messages: ["Safe error."], codes: [] } });
    for (const data of [{ error: secret }, { error: "Safe error.", code: "credential-marker" }, { error: "Safe error.", debug: secret }]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(data, { status: 409 })));
      const response = await call("/items", identity);
      expect(await response.json()).toEqual({ error: "Service request conflicts with current state.", code: "upstream_409" });
    }
  });
  it("maps connection failures and never retries mutations", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("private connection details " + secret)); vi.stubGlobal("fetch", fetcher);
    const response = await caller()("/items", identity, { method: "PATCH", body: { status: "example" } });
    expect(response.status).toBe(502); expect(await response.json()).toEqual({ error: "Service unavailable.", code: "service_unavailable" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("aborts once after five seconds without retrying", async () => {
    vi.useFakeTimers(); let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const fetcher = vi.fn().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("private timeout detail"))); started();
    })); vi.stubGlobal("fetch", fetcher);
    const pending = caller()("/items", identity, { method: "POST", body: {} });
    await ready; await vi.advanceTimersByTimeAsync(SERVICE_TIMEOUT_MS - 1);
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const response = await pending;
    expect(response.status).toBe(504); expect(await response.json()).toEqual({ error: "Service request timed out.", code: "service_timeout" });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("allows a development route cold compile without changing the production timeout", async () => {
    vi.useFakeTimers(); vi.stubEnv("NODE_ENV", "development"); let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const fetcher = vi.fn().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("private timeout detail"))); started();
    })); vi.stubGlobal("fetch", fetcher);
    const pending = caller()("/items", identity);
    await ready; await vi.advanceTimersByTimeAsync(SERVICE_TIMEOUT_MS);
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(DEVELOPMENT_SERVICE_TIMEOUT_MS - SERVICE_TIMEOUT_MS);
    expect((await pending).status).toBe(504);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps the timeout active while reading the body", async () => {
    vi.useFakeTimers(); let reading!: () => void; const ready = new Promise<void>(resolve => { reading = resolve; });
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, options) => Promise.resolve({
      ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }),
      json: () => new Promise((_resolve, reject) => { options.signal.addEventListener("abort", () => reject(new Error("body aborted"))); reading(); }),
    })));
    const pending = caller()("/items", identity); await ready;
    await vi.advanceTimersByTimeAsync(SERVICE_TIMEOUT_MS);
    expect((await pending).status).toBe(504);
  });
  it("rejects HTML responses and does not follow redirects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private HTML", { headers: { "Content-Type": "text/html" } })));
    expect((await caller()("/items", identity)).status).toBe(502);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: "https://attacker.test" } })));
    expect((await caller()("/items", identity)).status).toBe(502);
  });
  it("supports empty successful responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const response = await caller()("/items", identity, { method: "DELETE" });
    expect(response.status).toBe(204); expect(await response.text()).toBe("");
  });
  it.each(["token", "secret"])("rejects credentials echoed in successful JSON (%s)", async echoed => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, options) => Promise.resolve(Response.json({
      debug: echoed === "token" ? options.headers.Authorization : secret,
    }))));
    const response = await caller()("/items", identity);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Invalid service response.", code: "service_response" });
  });
  it("cancels unread upstream bodies after handling an error", async () => {
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, options) => {
      options.signal.addEventListener("abort", () => { void body.cancel(); });
      return Promise.resolve(new Response(body, { status: 403 }));
    }));
    expect((await caller()("/items", identity)).status).toBe(403);
    expect(cancelled).toBe(true);
  });
  it("times out a real upstream response stalled after headers", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write('{"incomplete":');
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Local fixture unavailable");
      const response = await createServiceCaller({ baseUrl: "http://127.0.0.1:" + address.port, secret })("/fixture", identity);
      expect(response.status).toBe(504);
      expect(await response.json()).toEqual({ error: "Service request timed out.", code: "service_timeout" });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }, 10000);
  it("does not log inputs or expose sensitive failure details", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(secret + " private-token-marker")));
    const body = await (await caller()("/items", identity)).text();
    expect(body).not.toContain(secret); expect(body).not.toContain("private-token-marker");
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
});
