import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserIdentity } from "@unitrack/contracts";

vi.mock("server-only", () => ({}));

import { equipmentHttp } from "../lib/equipment-http";

const itemId = "550e8400-e29b-41d4-a716-446655440001";
const actor: UserIdentity = {
  kind: "user",
  sub: "550e8400-e29b-41d4-a716-446655440002",
  role: "lab_assistant",
  lab_id: 7,
  rid: "equipment-http-test",
};

beforeEach(() => {
  vi.stubEnv("INTERNAL_JWT_SECRET", "public-dummy-equipment-http-secret");
  vi.stubEnv("EQUIPMENT_SERVICE_URL", "http://equipment.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("classifies a non-JSON 404 before parsing the body", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    new Response("not found", { status: 404, headers: { "Content-Type": "text/plain" } }),
  ));

  await expect(equipmentHttp(actor).getItem(itemId, actor.lab_id)).resolves.toBeNull();
});

it("preserves a non-JSON Equipment conflict as a deterministic rejection", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    new Response("conflict", { status: 409, headers: { "Content-Type": "text/plain" } }),
  ));

  const action = equipmentHttp(actor).changeStatus({
    itemId,
    labId: actor.lab_id,
    changedBy: actor.sub,
    status: "available",
    expectedStatus: ["checked_out"],
    idempotencyKey: "return:test:apply",
    reason: "Return test",
  });

  await expect(action).rejects.toMatchObject({
    status: 409,
    code: "equipment_rejected",
  });
});

it("fails uncertain on a successful response without the JSON contract", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    new Response("ok", { status: 200, headers: { "Content-Type": "text/plain" } }),
  ));

  await expect(equipmentHttp(actor).getItem(itemId, actor.lab_id)).rejects.toMatchObject({
    status: 503,
    code: "return_state_uncertain",
  });
});
