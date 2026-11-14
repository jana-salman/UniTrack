import { beforeEach, describe, expect, it, vi } from "vitest";

import { PATCH } from "@/app/api/items/[id]/route";
import { requireRole } from "@/lib/auth/authorization";
import { AuthorizationError } from "@/lib/auth/errors";
import { updateEquipment } from "@/lib/equipment-queries";

// Mock authentication.
vi.mock("@/lib/auth/authorization", () => ({
  requireRole: vi.fn(),
}));

// Mock database access so tests don't modify PostgreSQL.
vi.mock("@/lib/db", () => ({
  getDatabasePool: () => ({
    query: vi.fn(),
  }),
}));

// Mock the equipment update function.
vi.mock("@/lib/equipment-queries", () => ({
  updateEquipment: vi.fn(),
}));

const ITEM_ID = "a0452b1e-e0cc-47eb-b2a3-21f6010fc2dd";

const validInput = {
  name: "Updated Test Drone",
  description: "Updated equipment description",
  serial_number: "TEST-SN-002",
  category_id: 1,
  condition: "good",
  is_restricted: false,
};

function makeRequest(body: unknown): Request {
  return new Request(`http://localhost:3000/api/items/${ITEM_ID}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function makeContext(id = ITEM_ID): RouteContext<"/api/items/[id]"> {
  return {
    params: Promise.resolve({ id }),
  };
}

describe("PATCH /api/items/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(requireRole).mockResolvedValue({
      id: "test-manager",
      full_name: "Test Manager",
      university_email: "manager@aub.edu.lb",
      role: "lab_manager",
      lab_id: 1,
      is_active: true,
    });

    vi.mocked(updateEquipment).mockResolvedValue({
      id: ITEM_ID,
      ...validInput,
      lab_id: 1,
    });
  });

  it("allows Lab Managers to edit equipment", async () => {
    const response = await PATCH(
      makeRequest(validInput),
      makeContext()
    );

    expect(response.status).toBe(200);

    expect(requireRole).toHaveBeenCalledWith(["lab_manager"]);

    expect(updateEquipment).toHaveBeenCalledWith(
      expect.any(Object),
      ITEM_ID,
      1,
      validInput
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

    const response = await PATCH(
      makeRequest(validInput),
      makeContext()
    );

    expect(response.status).toBe(401);
    expect(updateEquipment).not.toHaveBeenCalled();
  });

  it("rejects users without permission with 403", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError(
        403,
        "insufficient_role",
        "Permission denied."
      )
    );

    const response = await PATCH(
      makeRequest(validInput),
      makeContext()
    );

    expect(response.status).toBe(403);
    expect(updateEquipment).not.toHaveBeenCalled();
  });

  it("rejects invalid equipment UUIDs", async () => {
    const response = await PATCH(
      makeRequest(validInput),
      makeContext("invalid-id")
    );

    expect(response.status).toBe(400);
    expect(updateEquipment).not.toHaveBeenCalled();
  });

  it("rejects empty equipment names", async () => {
    const response = await PATCH(
      makeRequest({
        ...validInput,
        name: "   ",
      }),
      makeContext()
    );

    expect(response.status).toBe(400);
    expect(updateEquipment).not.toHaveBeenCalled();
  });

  it("rejects invalid category IDs", async () => {
    const response = await PATCH(
      makeRequest({
        ...validInput,
        category_id: -1,
      }),
      makeContext()
    );

    expect(response.status).toBe(400);
    expect(updateEquipment).not.toHaveBeenCalled();
  });

  it("rejects invalid equipment conditions", async () => {
    const response = await PATCH(
      makeRequest({
        ...validInput,
        condition: "excellent",
      }),
      makeContext()
    );

    expect(response.status).toBe(400);
    expect(updateEquipment).not.toHaveBeenCalled();
  });

  it("returns 404 when equipment is not found in the manager's lab", async () => {
    vi.mocked(updateEquipment).mockResolvedValue(null);

    const response = await PATCH(
      makeRequest(validInput),
      makeContext()
    );

    expect(response.status).toBe(404);
  });

  it("rejects malformed JSON with 400", async () => {
    const request = new Request(
      `http://localhost:3000/api/items/${ITEM_ID}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{invalid-json",
      }
    );

    const response = await PATCH(request, makeContext());

    expect(response.status).toBe(400);
    expect(updateEquipment).not.toHaveBeenCalled();
  });

  it("rejects invalid category references with 400", async () => {
    const databaseError = Object.assign(
      new Error("Foreign key violation"),
      { code: "23503" }
    );

    vi.mocked(updateEquipment).mockRejectedValue(databaseError);

    const response = await PATCH(
      makeRequest(validInput),
      makeContext()
    );

    expect(response.status).toBe(400);
  });
});