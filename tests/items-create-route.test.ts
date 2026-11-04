import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/items/route";
import { requireRole } from "@/lib/auth/authorization";
import { AuthorizationError } from "@/lib/auth/errors";
import { createEquipment } from "@/lib/equipment-queries";

// Prevent tests from accessing the real database.
vi.mock("@/lib/db", () => ({
  pool: {},
}));

// Mock authentication.
vi.mock("@/lib/auth/authorization", () => ({
  requireRole: vi.fn(),
}));

// Mock equipment database operations.
vi.mock("@/lib/equipment-queries", () => ({
  createEquipment: vi.fn(),
}));

// Isolate the catalogue functionality from these POST tests.
vi.mock("@/lib/catalogue-query", () => ({
  getCatalogue: vi.fn(),
}));

const managerProfile = {
  id: "test-manager",
  full_name: "Test Manager",
  university_email: "manager@mail.aub.edu",
  role: "lab_manager" as const,
  lab_id: 1,
  is_active: true,
};

const validEquipment = {
  asset_code: "EQ-001",
  name: "Arduino Uno",
  category_id: 1,
  condition: "good",
  is_restricted: false,
};

// Create a simulated HTTP request.
function makeRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/items", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/items", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Simulate an authenticated Lab Manager.
    vi.mocked(requireRole).mockResolvedValue(managerProfile);

    // Simulate successful equipment creation.
    vi.mocked(createEquipment).mockResolvedValue({
      id: "item-123",
      asset_code: "EQ-001",
      name: "Arduino Uno",
      lab_id: 1,
    });
  });

  it("allows Lab Managers to create equipment", async () => {
    const response = await POST(makeRequest(validEquipment));

    expect(response.status).toBe(201);

    expect(await response.json()).toEqual({
      id: "item-123",
      asset_code: "EQ-001",
      name: "Arduino Uno",
      lab_id: 1,
    });

    expect(requireRole).toHaveBeenCalledWith(["lab_manager"]);
    expect(createEquipment).toHaveBeenCalledOnce();
  });

  it("uses the manager's laboratory ID and identity", async () => {
    const response = await POST(
      makeRequest({
        ...validEquipment,
        lab_id: 999,
        created_by: "another-user",
      })
    );

    expect(response.status).toBe(201);

    expect(createEquipment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        lab_id: 1,
      }),
      "test-manager"
    );
  });

  it("rejects unauthenticated users with 401", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError(
        401,
        "unauthenticated",
        "Sign in is required."
      )
    );

    const response = await POST(makeRequest(validEquipment));

    expect(response.status).toBe(401);
    expect(createEquipment).not.toHaveBeenCalled();
  });

  it("rejects unauthorized roles with 403", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError(
        403,
        "insufficient_role",
        "You do not have permission."
      )
    );

    const response = await POST(makeRequest(validEquipment));

    expect(response.status).toBe(403);
    expect(createEquipment).not.toHaveBeenCalled();
  });

  it("rejects managers without a valid laboratory", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ...managerProfile,
      lab_id: 0,
    });

    const response = await POST(makeRequest(validEquipment));

    expect(response.status).toBe(403);
    expect(createEquipment).not.toHaveBeenCalled();
  });

  it("rejects empty equipment names with 400", async () => {
    const response = await POST(
      makeRequest({
        ...validEquipment,
        name: "   ",
      })
    );

    expect(response.status).toBe(400);
    expect(createEquipment).not.toHaveBeenCalled();
  });

  it("rejects invalid category IDs with 400", async () => {
    const response = await POST(
      makeRequest({
        ...validEquipment,
        category_id: -1,
      })
    );

    expect(response.status).toBe(400);
    expect(createEquipment).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with 400", async () => {
    const request = new Request(
      "http://localhost:3000/api/items",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{invalid json",
      }
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(createEquipment).not.toHaveBeenCalled();
  });

  it("rejects duplicate asset codes with 409", async () => {
    const duplicateError = Object.assign(
      new Error("Duplicate asset code"),
      { code: "23505" }
    );

    vi.mocked(createEquipment).mockRejectedValue(duplicateError);

    const response = await POST(makeRequest(validEquipment));

    expect(response.status).toBe(409);
  });

  it("rejects invalid foreign keys with 400", async () => {
    const foreignKeyError = Object.assign(
      new Error("Foreign key violation"),
      { code: "23503" }
    );

    vi.mocked(createEquipment).mockRejectedValue(foreignKeyError);

    const response = await POST(makeRequest(validEquipment));

    expect(response.status).toBe(400);
  });

  it("handles unavailable authentication with 503", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError(
        503,
        "auth_not_configured",
        "University login is not configured."
      )
    );

    const response = await POST(makeRequest(validEquipment));

    expect(response.status).toBe(503);
    expect(createEquipment).not.toHaveBeenCalled();
  });
});