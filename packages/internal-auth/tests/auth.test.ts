import { afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT, decodeJwt, generateKeyPair } from "jose";
import type { InternalIdentity } from "@unitrack/contracts";
import { getRequestId, isRequestId, signInternalToken, verifyInternalToken } from "@unitrack/internal-auth";

// Deliberately public dummy values; no credentials or environment loading.
const secret = "dummy-test-secret-do-not-use-in-production";
const key = new TextEncoder().encode(secret);
const user = { kind: "user", sub: "profile-123", role: "lab_assistant", lab_id: 1, rid: "request-123" } as const;
const service = { kind: "service", sub: "gateway", role: "service", lab_id: null, rid: "request-456" } as const;
const now = 1800000000;
const claims = () => ({ sub: user.sub, role: user.role, lab_id: user.lab_id, rid: user.rid, iss: "unitrack-gateway", iat: now, exp: now + 60 });
async function signed(overrides: Record<string, unknown> = {}, omit?: string) {
  const payload: Record<string, unknown> = { ...claims(), ...overrides };
  if (omit) delete payload[omit];
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).sign(key);
}
afterEach(() => vi.useRealTimers());
function freeze() { vi.useFakeTimers(); vi.setSystemTime(now * 1000); }

describe("internal identity tokens", () => {
  it.each([user, service])("round-trips a $kind identity with exact lifetime", async (input) => {
    freeze();
    const token = await signInternalToken(input, secret);
    expect(await verifyInternalToken(token, secret)).toEqual(input);
    expect(decodeJwt(token)).toMatchObject({ iss: "unitrack-gateway", iat: now, exp: now + 60 });
  });
  it.each([undefined, null, "", " ", "bad", "a.b.c", 123])("rejects missing/malformed token %s", async (token) => {
    await expect(verifyInternalToken(token, secret)).rejects.toThrow("Internal authentication failed.");
  });
  it("rejects the wrong signature without disclosing input", async () => {
    const token = await signInternalToken(user, secret);
    await expect(verifyInternalToken(token, "another-public-dummy-secret")).rejects.toThrow(/^Internal authentication failed\.$/);
  });
  it("rejects a tampered payload", async () => {
    const token = await signInternalToken(user, secret);
    const parts = token.split(".");
    parts[1] = Buffer.from(JSON.stringify({ ...decodeJwt(token), role: "lab_manager" })).toString("base64url");
    await expect(verifyInternalToken(parts.join("."), secret)).rejects.toThrow();
  });
  it("expires exactly at 60 seconds", async () => {
    freeze(); const token = await signInternalToken(user, secret);
    vi.setSystemTime((now + 59) * 1000); expect(await verifyInternalToken(token, secret)).toEqual(user);
    vi.setSystemTime((now + 60) * 1000); await expect(verifyInternalToken(token, secret)).rejects.toThrow();
  });
  it("rejects wrong issuer", async () => {
    freeze(); await expect(verifyInternalToken(await signed({ iss: "other" }), secret)).rejects.toThrow();
  });
  it("rejects HS384 even with the correct shared key", async () => {
    freeze(); const token = await new SignJWT(claims()).setProtectedHeader({ alg: "HS384" }).sign(key);
    await expect(verifyInternalToken(token, secret)).rejects.toThrow();
  });
  it("rejects an asymmetric signing algorithm", async () => {
    freeze(); const pair = await generateKeyPair("ES256");
    const token = await new SignJWT(claims()).setProtectedHeader({ alg: "ES256" }).sign(pair.privateKey);
    await expect(verifyInternalToken(token, secret)).rejects.toThrow();
  });
  it("rejects unsigned JWTs", async () => {
    freeze(); const token = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url") + "." + Buffer.from(JSON.stringify(claims())).toString("base64url") + ".";
    await expect(verifyInternalToken(token, secret)).rejects.toThrow();
  });
  it.each(["sub", "role", "lab_id", "rid", "iss", "iat", "exp"])("requires %s", async (claim) => {
    freeze(); await expect(verifyInternalToken(await signed({}, claim), secret)).rejects.toThrow();
  });
  it.each([
    { role: "admin" }, { role: 1 }, { role: null },
    { sub: "" }, { sub: 1 }, { sub: "gateway" },
    { lab_id: 0 }, { lab_id: -1 }, { lab_id: 1.5 }, { lab_id: "1" }, { lab_id: null }, { lab_id: Number.MAX_SAFE_INTEGER + 1 },
    { rid: "" }, { rid: 1 }, { rid: "header\r\ninjection" },
    { iat: "1800000000" }, { exp: "1800000060" },
    { iat: now + 1, exp: now + 61 }, { exp: now + 120 }, { exp: now + 59 },
    { role: "service", sub: "profile-123", lab_id: null },
    { role: "service", sub: "gateway", lab_id: 1 },
  ])("rejects invalid signed claims %j", async (overrides) => {
    freeze(); await expect(verifyInternalToken(await signed(overrides), secret)).rejects.toThrow();
  });
  it.each([undefined, "", "   "])("requires explicit nonempty secret for signing and verification", async (value) => {
    await expect(signInternalToken(user, value as string)).rejects.toThrow(/^Internal authentication failed\.$/);
    await expect(verifyInternalToken("token-must-not-appear-in-error", value as string)).rejects.toThrow(/^Internal authentication failed\.$/);
  });
  it("rejects a contradictory identity kind when signing", async () => {
    await expect(signInternalToken({ ...user, kind: "service" } as unknown as InternalIdentity, secret)).rejects.toThrow();
  });
  it("rejects invalid identity input before signing", async () => {
    await expect(signInternalToken({ ...user, lab_id: 0 }, secret)).rejects.toThrow();
  });
});
describe("error privacy", () => {
  it("does not log or attach token/secret material to failures", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    try {
      const token = await signInternalToken(user, secret);
      for (const operation of [
        () => verifyInternalToken(token, "wrong-public-dummy-secret"),
        () => verifyInternalToken("sensitive-token-marker", secret),
        () => signInternalToken({ ...user, lab_id: -1 }, secret),
      ]) {
        const error = await operation().catch((failure: unknown) => failure);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("Internal authentication failed.");
        expect((error as Error).cause).toBeUndefined();
        const serialized = JSON.stringify(error) + String(error);
        expect(serialized).not.toContain(secret);
        expect(serialized).not.toContain(token);
        expect(serialized).not.toContain("sensitive-token-marker");
      }
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally { for (const spy of spies) spy.mockRestore(); }
  });
});
describe("request IDs", () => {
  it("preserves a bounded header-safe identifier", () => expect(getRequestId("existing.request_1-2")).toBe("existing.request_1-2"));
  it.each([undefined, null, "", " ", "bad id", "bad\r\nid", "trailing\n", "trailing\r", "x".repeat(129), 42])("generates for absent/invalid ID %s", (value) => {
    const a = getRequestId(value); const b = getRequestId(value);
    expect(isRequestId(a)).toBe(true); expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("accepts the maximum length and rejects longer IDs", () => {
    expect(isRequestId("a".repeat(128))).toBe(true); expect(isRequestId("a".repeat(129))).toBe(false);
  });
});
