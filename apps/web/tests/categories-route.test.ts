import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/categories/route";
import { requireRole } from "@/lib/auth/authorization";
import { AuthorizationError } from "@/lib/auth/errors";
import { createCategory } from "@/lib/category-queries";

// Mock the database so tests never modify PostgreSQL.
vi.mock("@/lib/db", () => ({
  pool: {},
}));

// Mock authentication.
vi.mock("@/lib/auth/authorization", () => ({
  requireRole: vi.fn(),
}));

// Mock database query functions.
vi.mock("@/lib/category-queries", () => ({
  getActiveCategories: vi.fn(),
  createCategory: vi.fn(),
}));

// Create a simulated HTTP POST request.
function makeRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/categories", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/categories", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // By default, simulate an authenticated Lab Manager.
    vi.mocked(requireRole).mockResolvedValue({
      id: "test-user",
      full_name: "Test Manager",
      university_email: "manager@aub.edu.lb",
      role: "lab_manager",
      lab_id: 1,
      is_active: true,
    });

    // By default, simulate a successful database insertion.
    vi.mocked(createCategory).mockResolvedValue({
      id: 11,
      name: "Drones",
    });
  });

  it("allows Lab Managers to create categories", async () => {
    const response = await POST(
      makeRequest({
        name: "Drones",
        description: "Drones and their accessories",
      })
    );

    expect(response.status).toBe(201);

    expect(await response.json()).toEqual({
      id: 11,
      name: "Drones",
    });

    expect(requireRole).toHaveBeenCalledWith(["lab_manager"]);
    expect(createCategory).toHaveBeenCalledOnce();
  });

  it("rejects unauthenticated users with 401", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError(
        401,
        "unauthenticated",
        "Sign in is required."
      )
    );

    const response = await POST(
      makeRequest({ name: "Drones" })
    );

    expect(response.status).toBe(401);
    expect(createCategory).not.toHaveBeenCalled();
  });

  it("rejects users without permission with 403", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError(
        403,
        "insufficient_role",
        "You do not have permission to perform this action."
      )
    );

    const response = await POST(
      makeRequest({ name: "Drones" })
    );

    expect(response.status).toBe(403);
    expect(createCategory).not.toHaveBeenCalled();
  });

  it("rejects empty category names with 400", async () => {
    const response = await POST(
      makeRequest({ name: "   " })
    );

    expect(response.status).toBe(400);
    expect(createCategory).not.toHaveBeenCalled();
  });

  it("rejects category names longer than 100 characters", async () => {
    const response = await POST(
      makeRequest({ name: "A".repeat(101) })
    );

    expect(response.status).toBe(400);
    expect(createCategory).not.toHaveBeenCalled();
  });

  it("rejects duplicate categories with 409", async () => {
    // PostgreSQL error code 23505 means a unique constraint failed.
    const duplicateError = Object.assign(
      new Error("Duplicate category"),
      { code: "23505" }
    );

    vi.mocked(createCategory).mockRejectedValue(duplicateError);

    const response = await POST(
      makeRequest({ name: "Drones" })
    );

    expect(response.status).toBe(409);
  });

  it("rejects requests when authentication is not configured", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError(
        503,
        "auth_not_configured",
        "University login is not configured."
      )
    );

    const response = await POST(
      makeRequest({ name: "Drones" })
    );

    expect(response.status).toBe(503);
    expect(createCategory).not.toHaveBeenCalled();
  });
});