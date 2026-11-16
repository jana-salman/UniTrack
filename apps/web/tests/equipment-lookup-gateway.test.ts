
import { beforeEach, describe, expect, it, vi } from "vitest";

const { forward } = vi.hoisted(() => ({
  forward: vi.fn(),
}));

vi.mock("@/lib/gateway/equipment", () => ({
  forwardEquipment: forward,
}));

import { GET } from "@/app/api/items/lookup/route";

describe("Web equipment lookup gateway", () => {
  beforeEach(() => {
    forward.mockReset();
    forward.mockResolvedValue(
      Response.json({ id: "equipment-123" })
    );
  });

  it.each([
    ["UUID", "550e8400-e29b-41d4-a716-446655440000"],
    ["asset code", "EQ-001"],
    ["serial number", "SN-12345"],
  ])("forwards lookup by %s", async (_type, identifier) => {
    const request = new Request(
      `http://web.test/api/items/lookup?q=${encodeURIComponent(identifier)}`
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(forward).toHaveBeenCalledExactlyOnceWith(
      request,
      `/items/lookup?q=${encodeURIComponent(identifier)}`
    );
  });

  it("handles a missing identifier", async () => {
    const request = new Request(
      "http://web.test/api/items/lookup"
    );

    await GET(request);

    expect(forward).toHaveBeenCalledExactlyOnceWith(
      request,
      "/items/lookup?q="
    );
  });

  it("safely encodes special characters", async () => {
    const identifier = "EQ 001 & 002";

    const request = new Request(
      `http://web.test/api/items/lookup?q=${encodeURIComponent(identifier)}`
    );

    await GET(request);

    expect(forward).toHaveBeenCalledExactlyOnceWith(
      request,
      `/items/lookup?q=${encodeURIComponent(identifier)}`
    );
  });
});
