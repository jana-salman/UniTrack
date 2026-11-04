
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  connect: vi.fn(),
  updateEquipmentStatus: vi.fn(),
}));

vi.mock("@/lib/auth/authorization", () => ({
  requireRole: mocks.requireRole,
}));

vi.mock("@/lib/auth/errors", () => ({
  AuthorizationError: class AuthorizationError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string
    ) {
      super(message);
    }
  },
}));

vi.mock("@/lib/db", () => ({
  getDatabasePool: () => ({
    connect: mocks.connect,
  }),
}));

vi.mock("@/lib/equipment-status-transaction", () => ({
  updateEquipmentStatus: mocks.updateEquipmentStatus,
}));

import { PATCH } from "@/app/api/items/[id]/status/route";
import { AuthorizationError } from "@/lib/auth/errors";

const itemId = "550e8400-e29b-41d4-a716-446655440000";

const context = {
  params: Promise.resolve({ id: itemId }),
} as RouteContext<"/api/items/[id]/status">;

function makeRequest(body: unknown): Request {
  return new Request(`http://localhost/api/items/${itemId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  mocks.requireRole.mockResolvedValue({
    id: "550e8400-e29b-41d4-a716-446655440001",
    role: "lab_manager",
    lab_id: 1,
  });
});

test("rejects invalid status input", async () => {
  const response = await PATCH(makeRequest({ status: 123 }), context);

  expect(response.status).toBe(400);
  expect(mocks.connect).not.toHaveBeenCalled();
});

test("rejects equipment retirement by lab assistants", async () => {
  mocks.requireRole.mockResolvedValue({
    id: "550e8400-e29b-41d4-a716-446655440001",
    role: "lab_assistant",
    lab_id: 1,
  });

  const response = await PATCH(
    makeRequest({ status: "retired" }),
    context
  );

  expect(response.status).toBe(403);
  expect(mocks.connect).not.toHaveBeenCalled();
});

test("rejects users without laboratory assignment", async () => {
  mocks.requireRole.mockResolvedValue({
    id: "550e8400-e29b-41d4-a716-446655440001",
    role: "lab_manager",
    lab_id: null,
  });

  const response = await PATCH(
    makeRequest({ status: "available" }),
    context
  );

  expect(response.status).toBe(403);
  expect(mocks.connect).not.toHaveBeenCalled();
});

test("returns 401 for unauthenticated users", async () => {
  mocks.requireRole.mockRejectedValue(
    new AuthorizationError(
      401,
      "unauthenticated",
      "Sign in is required."
    )
  );

  const response = await PATCH(
    makeRequest({ status: "available" }),
    context
  );

  expect(response.status).toBe(401);
  expect(mocks.connect).not.toHaveBeenCalled();
});

test("returns 403 for insufficient permissions", async () => {
  mocks.requireRole.mockRejectedValue(
    new AuthorizationError(
      403,
      "insufficient_role",
      "You do not have permission to perform this action."
    )
  );

  const response = await PATCH(
    makeRequest({ status: "available" }),
    context
  );

  expect(response.status).toBe(403);
  expect(mocks.connect).not.toHaveBeenCalled();
});


test("allows lab managers to update equipment status", async () => {
  const release = vi.fn();

  mocks.connect.mockResolvedValue({ release });
  mocks.updateEquipmentStatus.mockResolvedValue({
    itemId,
    status: "under_maintenance",
    changed: true,
  });

  const response = await PATCH(
    makeRequest({ status: "under_maintenance", reason: "Needs repair" }),
    context
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    itemId,
    status: "under_maintenance",
    changed: true,
  });

  expect(mocks.updateEquipmentStatus).toHaveBeenCalledWith(
    expect.objectContaining({ release }),
    itemId,
    "under_maintenance",
    "550e8400-e29b-41d4-a716-446655440001",
    1,
    "Needs repair"
  );

  expect(release).toHaveBeenCalledOnce();
});

test("allows lab managers to retire equipment", async () => {
  const release = vi.fn();

  mocks.connect.mockResolvedValue({ release });
  mocks.updateEquipmentStatus.mockResolvedValue({
    itemId,
    status: "retired",
    changed: true,
  });

  const response = await PATCH(
    makeRequest({ status: "retired", reason: "End of service" }),
    context
  );

  expect(response.status).toBe(200);
  expect(mocks.updateEquipmentStatus).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledOnce();
});

test("does not create duplicate history for unchanged status", async () => {
  const release = vi.fn();

  mocks.connect.mockResolvedValue({ release });
  mocks.updateEquipmentStatus.mockResolvedValue({
    itemId,
    status: "available",
    changed: false,
  });

  const response = await PATCH(
    makeRequest({ status: "available" }),
    context
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    itemId,
    status: "available",
    changed: false,
  });

  expect(release).toHaveBeenCalledOnce();
});

test("returns 404 when equipment is missing or belongs to another lab", async () => {
  const release = vi.fn();

  mocks.connect.mockResolvedValue({ release });
  mocks.updateEquipmentStatus.mockRejectedValue(
    new Error("Equipment item not found or access denied")
  );

  const response = await PATCH(
    makeRequest({ status: "retired" }),
    context
  );

  expect(response.status).toBe(404);
  expect(release).toHaveBeenCalledOnce();
});


test("rejects malformed JSON", async () => {
  const request = new Request(
    `http://localhost/api/items/${itemId}/status`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "{invalid-json",
    }
  );

  const response = await PATCH(request, context);

  expect(response.status).toBe(400);
  expect(mocks.connect).not.toHaveBeenCalled();
});

test("releases database connection when status update fails", async () => {
  const release = vi.fn();

  mocks.connect.mockResolvedValue({ release });
  mocks.updateEquipmentStatus.mockRejectedValue(
    new Error("Database failure")
  );

  const consoleSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => {});

  try {
    const response = await PATCH(
      makeRequest({ status: "checked_out" }),
      context
    );

    expect(response.status).toBe(500);
    expect(release).toHaveBeenCalledOnce();
  } finally {
    consoleSpy.mockRestore();
  }
});


test("rejects invalid equipment UUID before connecting to database", async () => {
  const invalidContext = {
    params: Promise.resolve({ id: "invalid-id" }),
  } as RouteContext<"/api/items/[id]/status">;

  const response = await PATCH(
    makeRequest({ status: "available" }),
    invalidContext
  );

  expect(response.status).toBe(400);
  expect(mocks.connect).not.toHaveBeenCalled();
});

test("rejects invalid status before connecting to database", async () => {
  const response = await PATCH(
    makeRequest({ status: "broken" }),
    context
  );

  expect(response.status).toBe(400);
  expect(mocks.connect).not.toHaveBeenCalled();
});
