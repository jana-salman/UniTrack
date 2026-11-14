import { afterEach, describe, expect, it, vi } from "vitest";
import { signInternalToken } from "@unitrack/internal-auth";
vi.mock("server-only", () => ({}));
import { GET } from "../app/health/route";
import { fixture, GET as protectedGET } from "./fixtures/protected-route";
const secret = "public-dummy-test-secret-not-for-deployment";
const manager = { kind: "user", sub: "profile-1", role: "lab_manager", lab_id: 1, rid: "request-1" } as const;
const request = (token?: string) => new Request("http://service.test/fixture", { headers: token ? { Authorization: "Bearer " + token } : {} });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("loans route handlers", () => {
  it("serves public health without configuration", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ service: "loans", status: "ok", version: "0.1.0" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it.each([undefined, "bad.token", ""])("rejects absent/invalid tokens through a handler", async token => {
    const response = await protectedGET(request(token));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required.", code: "unauthorized" });
  });
  it("rejects expired tokens", async () => {
    vi.useFakeTimers(); const token = await signInternalToken(manager, secret);
    vi.advanceTimersByTime(60000);
    expect((await protectedGET(request(token))).status).toBe(401);
  });
  it("rejects a wrong signature and missing secret", async () => {
    const token = await signInternalToken(manager, secret);
    expect((await fixture("wrong-public-dummy-secret")(request(token))).status).toBe(401);
    expect((await fixture("")(request(token))).status).toBe(401);
  });
  it("accepts verified manager claims through a protected handler", async () => {
    const response = await protectedGET(request(await signInternalToken(manager, secret)));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ kind: "user", labId: 1 });
  });
  it("denies valid users without permission", async () => {
    const response = await protectedGET(request(await signInternalToken({ ...manager, role: "student" }, secret)));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Permission denied.", code: "forbidden" });
  });
  it("does not confuse a valid service identity with a manager", async () => {
    const token = await signInternalToken({ kind: "service", sub: "gateway", role: "service", lab_id: null, rid: "service-1" }, secret);
    expect((await protectedGET(request(token))).status).toBe(403);
  });
  it("does not expose credentials or log authentication inputs", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const response = await protectedGET(request("private-token-marker"));
    const body = await response.text();
    expect(body).not.toContain(secret); expect(body).not.toContain("private-token-marker");
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
});
