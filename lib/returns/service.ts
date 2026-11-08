import "server-only";

import { randomUUID } from "node:crypto";

import { validateReturnChecklist } from "./checklist";
import type {
  ReturnEquipmentPort,
  ReturnOutcome,
  ReturnStatusChange,
} from "./equipment-port";
import { requiresInspection } from "./inspection";
import { hasActivePickup } from "./queries";
import { determineReturnOutcome } from "./rules";
import { saveReturnRecordsInTransaction } from "./save-records";
import {
  ReturnTransactionError,
  withReturnTransaction,
} from "./transaction";
import { validateReturnInput } from "./validation";

interface ReturnActor {
  id: string;
  role: string;
  labId: number;
}

export async function confirmReturn(
  loanId: string,
  rawInput: unknown,
  actor: ReturnActor,
  equipment: ReturnEquipmentPort,
): Promise<ReturnOutcome> {
  if (actor.role !== "lab_assistant") {
    throw new Error("Only lab assistants can confirm returns.");
  }

  if (!Number.isInteger(actor.labId) || actor.labId <= 0) {
    throw new Error("Invalid laboratory assignment.");
  }

  const input = validateReturnInput(rawInput);
  let undoChange: ReturnStatusChange | undefined;

  try {
    return await withReturnTransaction(
      loanId,
      actor.labId,
      async ({ client, loan, pickupConditions }) => {
        validateReturnChecklist(pickupConditions, input.conditions);

        const item = await equipment.getItem(
          loan.item_id,
          actor.labId,
        );

        if (
          !item ||
          item.id !== loan.item_id ||
          item.labId !== actor.labId
        ) {
          throw new Error("Equipment item not found.");
        }

        if (
          item.status !== "checked_out" &&
          item.status !== "overdue"
        ) {
          throw new Error("Only borrowed or overdue items can be returned.");
        }

        const returnedAt = new Date();

        const activePickup = await hasActivePickup(
          loan,
          returnedAt,
          client,
        );

        const outcome = determineReturnOutcome(
          loan,
          returnedAt,
          requiresInspection(pickupConditions, input.conditions),
          activePickup,
        );

        const operationKey = `return:${loan.id}:${randomUUID()}`;

        const changed = await equipment.changeStatus({
          itemId: loan.item_id,
          labId: actor.labId,
          changedBy: actor.id,
          status: outcome.status,
          expectedStatus: [item.status],
          idempotencyKey: operationKey,
          reason: "Equipment return confirmed by lab assistant.",
        });

        if (!changed.changed) {
          throw new Error("The equipment status change was not confirmed.");
        }

        undoChange = {
          itemId: loan.item_id,
          labId: actor.labId,
          changedBy: actor.id,
          status: item.status,
          expectedStatus: [outcome.status],
          idempotencyKey: `${operationKey}:undo`,
          reason: "Return records could not be saved; restoring loan status.",
        };

        await saveReturnRecordsInTransaction(
          client,
          loan,
          input,
          returnedAt,
          actor.id,
        );

        return {
          loanId: loan.id,
          returnedAt: returnedAt.toISOString(),
          status: outcome.status,
          isLate: outcome.isLate,
        };
      },
    );
  } catch (error) {
    if (
      error instanceof ReturnTransactionError &&
      error.commitAttempted
    ) {
      throw error;
    }

    if (undoChange) {
      try {
        const restored = await equipment.changeStatus(undoChange);

        if (!restored.changed) {
          throw new Error("Equipment restoration was not confirmed.");
        }
      } catch {
        throw new Error(
          "The return failed and the equipment status needs staff verification.",
        );
      }
    }

    throw error;
  }
}