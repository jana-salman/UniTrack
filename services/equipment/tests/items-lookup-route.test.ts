import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/items/lookup/route";
import { requireRole } from "@/lib/auth/authorization";
import { AuthorizationError } from "@/lib/auth/errors";
import { findItemByIdentifier } from "@/lib/item-lookups";

// Mock authentication and equipment lookup.
// No real database connection is needed.
vi.mock("@/lib/auth/authorization", () => ({
  requireRole: vi.fn(),
}));

vi.mock("@/lib/item-lookups", () => ({
  findItemByIdentifier: vi.fn(),
}));

const itemId = "550e8400-e29b-41d4-a716-446655440000";

const equipment = {
  id: itemId,
  asset_code: "EQ-001",
  name: "Arduino Uno",
  serial_number: "SN-12345",
  status: "available",
  condition: "good",
  is_restricted: false,
  lab_id: 1,
};

function makeRequest(identifier: string): Request {
  return new Request(
    `http://localhost:3000/items/lookup?q=${encodeURIComponent(identifier)}`
  );
}

describe("GET /items/lookup", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(requireRole).mockResolvedValue({
      id: "test-assistant",
      role: "lab_assistant",
      lab_id: 1,
    });

    vi.mocked(findItemByIdentifier).mockResolvedValue(equipment);
  });

  it("finds equipment by UUID", async () => {
    const response = await GET(makeRequest(itemId));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(equipment);
    expect(findItemByIdentifier).toHaveBeenCalledWith(itemId, 1);
  });

  it("finds equipment by asset code", async () => {
    const response = await GET(makeRequest("EQ-001"));

    expect(response.status).toBe(200);
    expect(findItemByIdentifier).toHaveBeenCalledWith("EQ-001", 1);
  });

  it("finds equipment by serial number", async () => {
    const response = await GET(makeRequest("SN-12345"));

    expect(response.status).toBe(200);
    expect(findItemByIdentifier).toHaveBeenCalledWith("SN-12345", 1);
  });

  it.each([
    "lab_assistant",
    "lab_manager",
    "professor",
  ] as const)("allows equipment lookup for %s", async (role) => {
    vi.mocked(requireRole).mockResolvedValue({
      id: "test-user",
      role,
      lab_id: 1,
    });

    const response = await GET(makeRequest("EQ-001"));

    expect(response.status).toBe(200);

    expect(requireRole).toHaveBeenCalledWith(
      expect.any(Request),
      ["lab_assistant", "lab_manager", "professor"]
    );

    expect(findItemByIdentifier).toHaveBeenCalledWith(
      "EQ-001",
      1
    );
  });

  it("rejects unauthenticated users", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError(
        401,
        "unauthenticated",
        "Sign in is required."
      )
    );

    const response = await GET(makeRequest("EQ-001"));

    expect(response.status).toBe(401);
    expect(findItemByIdentifier).not.toHaveBeenCalled();
  });

  it("rejects unauthorized roles", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError(
        403,
        "insufficient_role",
        "You do not have permission to perform this action."
      )
    );

    const response = await GET(makeRequest("EQ-001"));

    expect(response.status).toBe(403);
    expect(findItemByIdentifier).not.toHaveBeenCalled();
  });

  it("rejects an empty identifier", async () => {
    const response = await GET(makeRequest("   "));

    expect(response.status).toBe(400);
    expect(findItemByIdentifier).not.toHaveBeenCalled();
  });

  it("rejects identifiers longer than 100 characters", async () => {
    const response = await GET(makeRequest("A".repeat(101)));

    expect(response.status).toBe(400);
    expect(findItemByIdentifier).not.toHaveBeenCalled();
  });

  it("returns 404 when equipment is not found", async () => {
    vi.mocked(findItemByIdentifier).mockResolvedValue(null);

    const response = await GET(makeRequest("UNKNOWN"));

    expect(response.status).toBe(404);
  });

  it("uses the authenticated user's lab ID", async () => {
    await GET(makeRequest("EQ-001"));

    expect(findItemByIdentifier).toHaveBeenCalledWith("EQ-001", 1);
  });
});