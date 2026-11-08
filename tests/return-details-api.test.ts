import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getReturnDetails: vi.fn(),
}));

vi.mock("@/lib/auth/authorization", () => ({
  requireRole: mocks.requireRole,
}));

vi.mock("@/lib/auth/errors", () => ({
  AuthorizationError: class AuthorizationError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

vi.mock("@/lib/returns/queries", () => ({
  getReturnDetails: mocks.getReturnDetails,
}));

vi.mock("@/lib/clients/return-equipment-client", () => ({
  returnEquipmentClient: {},
}));

vi.mock("@/lib/returns/service", () => ({
  confirmReturn: vi.fn(),
}));

vi.mock("server-only", () => ({}));

import { GET } from "@/app/api/returns/[loanId]/route";
import { AuthorizationError } from "@/lib/auth/errors";

const loanId = "550e8400-e29b-41d4-a716-446655440000";

function makeContext(id = loanId) {
  return {
    params: Promise.resolve({ loanId: id }),
  } as RouteContext<"/api/returns/[loanId]">;
}

function makeRequest() {
  return new Request(`http://localhost/api/returns/${loanId}`);
}

beforeEach(() => {
  vi.resetAllMocks();

  mocks.requireRole.mockResolvedValue({
    id: "550e8400-e29b-41d4-a716-446655440001",
    role: "lab_assistant",
    lab_id: 1,
  });
});

test("returns loan details for an authorized lab assistant", async () => {
  const details = {
    loan: { id: loanId, lab_id: 1, returned_at: null },
    pickupConditions: [],
  };

  mocks.getReturnDetails.mockResolvedValue(details);

  const response = await GET(makeRequest(), makeContext());

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(details);
  expect(mocks.requireRole).toHaveBeenCalledWith(["lab_assistant"]);
  expect(mocks.getReturnDetails).toHaveBeenCalledWith(loanId, 1);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});

test("returns 401 without authentication", async () => {
  mocks.requireRole.mockRejectedValue(
    new AuthorizationError(401, "unauthenticated", "Sign in is required."),
  );

  const response = await GET(makeRequest(), makeContext());

  expect(response.status).toBe(401);
  expect(mocks.getReturnDetails).not.toHaveBeenCalled();
});

test("returns 403 when authorization refuses the user's role", async () => {
  mocks.requireRole.mockRejectedValue(
    new AuthorizationError(403, "insufficient_role", "Access denied."),
  );

  const response = await GET(makeRequest(), makeContext());

  expect(response.status).toBe(403);
  expect(mocks.getReturnDetails).not.toHaveBeenCalled();
});

test("rejects a user without a lab", async () => {
  mocks.requireRole.mockResolvedValue({
    id: "assistant-id",
    role: "lab_assistant",
    lab_id: null,
  });

  const response = await GET(makeRequest(), makeContext());

  expect(response.status).toBe(403);
  expect(mocks.getReturnDetails).not.toHaveBeenCalled();
});

test("rejects a malformed loan ID before querying", async () => {
  const response = await GET(makeRequest(), makeContext("invalid-id"));

  expect(response.status).toBe(400);
  expect(mocks.getReturnDetails).not.toHaveBeenCalled();
});

test("returns 404 when the lab-scoped lookup finds no loan", async () => {
  mocks.getReturnDetails.mockResolvedValue(null);

  const response = await GET(makeRequest(), makeContext());

  expect(response.status).toBe(404);
  expect(mocks.getReturnDetails).toHaveBeenCalledWith(loanId, 1);
});

test("uses the authenticated user's lab for the lookup", async () => {
  mocks.requireRole.mockResolvedValue({
    id: "assistant-id",
    role: "lab_assistant",
    lab_id: 2,
  });

  mocks.getReturnDetails.mockResolvedValue(null);

  await GET(makeRequest(), makeContext());

  expect(mocks.getReturnDetails).toHaveBeenCalledWith(loanId, 2);
});

test("does not expose database errors to the caller", async () => {
  mocks.getReturnDetails.mockRejectedValue(
    new Error("Private database error details"),
  );

  const consoleSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => {});

  try {
    const response = await GET(makeRequest(), makeContext());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Unable to load return details.",
    });
  } finally {
    consoleSpy.mockRestore();
  }
});