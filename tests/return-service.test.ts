import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
  saveRecords: vi.fn(),
  hasActivePickup: vi.fn(),
  getItem: vi.fn(),
  changeStatus: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/db", () => ({
  getDatabasePool: () => ({
    connect: mocks.connect,
  }),
}));

vi.mock("@/lib/returns/save-records", () => ({
  saveReturnRecordsInTransaction: mocks.saveRecords,
}));

vi.mock("@/lib/returns/queries", () => ({
  hasActivePickup: mocks.hasActivePickup,
}));

import { confirmReturn } from "@/lib/returns/service";

const loanId = "550e8400-e29b-41d4-a716-446655440000";
const itemId = "550e8400-e29b-41d4-a716-446655440001";

const loan = {
  id: loanId,
  item_id: itemId,
  borrower_id: "student-id",
  reservation_id: null,
  lab_id: 1,
  borrowed_at: new Date("2000-01-01T08:00:00Z"),
  due_date: new Date("2100-01-01T08:00:00Z"),
  returned_at: null,
};

const pickupConditions = [
  {
    id: "pickup-record",
    kit_component_id: null,
    condition_status: "good",
    notes: null,
  },
];

const actor = {
  id: "assistant-id",
  role: "lab_assistant",
  labId: 1,
};

const input = {
  conditions: [
    {
      kitComponentId: null,
      conditionStatus: "good",
    },
  ],
};

const equipment = {
  getItem: mocks.getItem,
  changeStatus: mocks.changeStatus,
};

function databaseAnswer(sql: string) {
  if (sql.includes("from public.loans")) {
    return { rows: [loan] };
  }

  if (sql.includes("from public.condition_records")) {
    return { rows: pickupConditions };
  }

  return { rows: [] };
}

beforeEach(() => {
  vi.resetAllMocks();

  mocks.connect.mockResolvedValue({
    query: mocks.query,
    release: mocks.release,
  });

  mocks.query.mockImplementation(async (sql: string) =>
    databaseAnswer(sql),
  );

  mocks.getItem.mockResolvedValue({
    id: itemId,
    labId: 1,
    status: "checked_out",
  });

  mocks.changeStatus.mockResolvedValue({ changed: true });
  mocks.saveRecords.mockResolvedValue(undefined);
  mocks.hasActivePickup.mockResolvedValue(false);
});

test("saves a clean return after changing Equipment status", async () => {
  const result = await confirmReturn(
    loanId,
    input,
    actor,
    equipment,
  );

  expect(result).toMatchObject({
    loanId,
    status: "available",
    isLate: false,
  });

  expect(mocks.changeStatus).toHaveBeenCalledWith(
    expect.objectContaining({
      itemId,
      status: "available",
      expectedStatus: ["checked_out"],
      idempotencyKey: expect.any(String),
    }),
  );

  expect(mocks.saveRecords).toHaveBeenCalledOnce();

  expect(
    mocks.changeStatus.mock.invocationCallOrder[0],
  ).toBeLessThan(mocks.saveRecords.mock.invocationCallOrder[0]);

  expect(mocks.query).toHaveBeenCalledWith("COMMIT");
  expect(mocks.release).toHaveBeenCalledOnce();
});

test("does not save a return when Equipment fails", async () => {
  mocks.changeStatus.mockRejectedValue(
    new Error("Equipment unavailable"),
  );

  await expect(
    confirmReturn(loanId, input, actor, equipment),
  ).rejects.toThrow();

  expect(mocks.saveRecords).not.toHaveBeenCalled();
  expect(mocks.query).toHaveBeenCalledWith("ROLLBACK");
  expect(mocks.query).not.toHaveBeenCalledWith("COMMIT");
  expect(mocks.release).toHaveBeenCalledOnce();
});

test("restores Equipment when saving return records fails", async () => {
  mocks.saveRecords.mockRejectedValue(
    new Error("Condition insert failed"),
  );

  await expect(
    confirmReturn(loanId, input, actor, equipment),
  ).rejects.toThrow();

  expect(mocks.changeStatus).toHaveBeenCalledTimes(2);
  expect(mocks.changeStatus).toHaveBeenLastCalledWith(
    expect.objectContaining({
      status: "checked_out",
      expectedStatus: ["available"],
      idempotencyKey: expect.stringMatching(/:undo$/),
    }),
  );

  expect(mocks.query).toHaveBeenCalledWith("ROLLBACK");
  expect(mocks.release).toHaveBeenCalledOnce();
});

test("requires staff verification when restoration also fails", async () => {
  mocks.saveRecords.mockRejectedValue(new Error("Save failed"));

  mocks.changeStatus
    .mockResolvedValueOnce({ changed: true })
    .mockRejectedValueOnce(new Error("Restoration failed"));

  await expect(
    confirmReturn(loanId, input, actor, equipment),
  ).rejects.toThrow(
    "The return failed and the equipment status needs staff verification.",
  );
});

test("does not undo Equipment blindly when commit is uncertain", async () => {
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql === "COMMIT") {
      throw new Error("Connection lost during commit");
    }

    return databaseAnswer(sql);
  });

  await expect(
    confirmReturn(loanId, input, actor, equipment),
  ).rejects.toThrow(
    "The return could not be confirmed. Check its saved state before retrying.",
  );

  expect(mocks.changeStatus).toHaveBeenCalledOnce();
  expect(mocks.release).toHaveBeenCalledOnce();
});

test("rejects a loan that has already been returned", async () => {
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("from public.loans")) {
      return {
        rows: [
          {
            ...loan,
            returned_at: new Date("2026-01-01T08:00:00Z"),
          },
        ],
      };
    }

    return databaseAnswer(sql);
  });

  await expect(
    confirmReturn(loanId, input, actor, equipment),
  ).rejects.toThrow();

  expect(mocks.changeStatus).not.toHaveBeenCalled();
  expect(mocks.saveRecords).not.toHaveBeenCalled();
});

test("refuses equipment from a different laboratory", async () => {
  mocks.getItem.mockResolvedValue({
    id: itemId,
    labId: 2,
    status: "checked_out",
  });

  await expect(
    confirmReturn(loanId, input, actor, equipment),
  ).rejects.toThrow();

  expect(mocks.changeStatus).not.toHaveBeenCalled();
  expect(mocks.saveRecords).not.toHaveBeenCalled();
});

test("rejects a student before opening a database connection", async () => {
  await expect(
    confirmReturn(
      loanId,
      input,
      { ...actor, role: "student" },
      equipment,
    ),
  ).rejects.toThrow("Only lab assistants can confirm returns.");

  expect(mocks.connect).not.toHaveBeenCalled();
});