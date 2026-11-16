// In-memory transaction/lock MODEL. No SQL is executed; not PostgreSQL proof.
import type { Pool } from "pg";
import type { PickupCondition } from "../../lib/returns/types";
export const loanId = "550e8400-e29b-41d4-a716-446655440000";
export const itemId = "550e8400-e29b-41d4-a716-446655440001";
export const actorId = "550e8400-e29b-41d4-a716-446655440002";
export const borrowerId = "550e8400-e29b-41d4-a716-446655440003";
export function returnDatabase() {
  const state = {
    loan: { id: loanId, item_id: itemId, borrower_id: borrowerId, reservation_id: null, lab_id: 7, borrowed_at: new Date("2000-01-01"), due_date: new Date("2100-01-01"), returned_at: null as Date | null, return_operation: null as unknown },
    pickup: [{ id: "550e8400-e29b-41d4-a716-446655440010", kit_component_id: null, condition_status: "good", notes: null }] as PickupCondition[],
    records: [] as unknown[][],
  };
  let locked = false;
  const sql: { text: string; values: unknown[] }[] = [];
  const settings = { historyFailure: false, activePickup: false, commitFailure: "" as "" | "before" | "after", compensationCommitFailure: "" as "" | "before" | "after", planCommitFailure: "" as "" | "before" | "after", dropPlanWrite: false, rollbackFailure: false, legacyReturnAfterRollback: false };
  const pool = {
    async query(text: string, values: unknown[] = []) { sql.push({ text, values }); return answer(text, values); },
    async connect() {
      let snapshot: typeof state | undefined;
      let ownsLock = false;
      return {
        async query(text: string, values: unknown[] = []) {
          sql.push({ text, values });
          if (text.includes("pg_try_advisory_lock")) { const got = !locked; if (got) { locked = true; ownsLock = true; } return { rows: [{ locked: got }] }; }
          if (text.includes("pg_advisory_unlock")) { if (ownsLock) locked = false; ownsLock = false; return { rows: [] }; }
          if (text === "BEGIN") snapshot = structuredClone(state);
          if (text === "ROLLBACK") { if (settings.rollbackFailure) throw new Error("Dummy rollback connection loss"); if (snapshot) Object.assign(state, snapshot); snapshot = undefined; if (settings.legacyReturnAfterRollback) state.loan.returned_at = new Date(); }
          if (text === "COMMIT") {
            const op = state.loan.return_operation as { state: string } | null;
            const special = op?.state === "compensated" ? "compensationCommitFailure" : op?.state === "planned" ? "planCommitFailure" : undefined;
            if (special && settings[special]) {
              const mode = settings[special]; settings[special] = "";
              if (mode === "before" && snapshot) Object.assign(state, snapshot);
              snapshot = undefined; throw new Error("Dummy durable state commit response loss");
            }
            const final = state.records.length > 0;
            if (final && settings.commitFailure) {
              const mode = settings.commitFailure; settings.commitFailure = "";
              if (mode === "before" && snapshot) Object.assign(state, snapshot);
              snapshot = undefined; throw new Error("Dummy commit response loss");
            }
            snapshot = undefined;
          }
          return answer(text, values);
        },
        release(destroy?: boolean) { if (ownsLock) locked = false; if (destroy && snapshot) Object.assign(state, snapshot); },
      };
    },
  };
  async function answer(text: string, values: unknown[]) {
    const returnedConditions = () => state.records.map((v, index) => ({ id: "550e8400-e29b-41d4-a716-" + String(index + 100).padStart(12, "0"), loan_id: loanId, item_id: itemId, kit_component_id: v[2], phase: "return", condition_status: v[4], notes: v[5], recorded_at: v[7] }));
    if (text.includes("from public.loans where borrower_id")) return { rows: state.loan.borrower_id === values[0] && state.loan.lab_id === values[1] && state.loan.returned_at ? [structuredClone(state.loan)] : [] };
    if (text.includes("from public.condition_records c join")) {
      if (state.loan.borrower_id !== values[0] || state.loan.lab_id !== values[1] || !state.loan.returned_at) return { rows: [] };
      return { rows: [...state.pickup.map(row => ({ ...row, loan_id: loanId, item_id: itemId, phase: "pickup", recorded_at: state.loan.borrowed_at })), ...returnedConditions()] };
    }
    if (text.includes("from public.condition_records") && text.includes("phase = 'return'")) return { rows: values[0] === loanId && values[1] === itemId && values[2] === state.loan.lab_id ? returnedConditions() : [] };
    if (text.includes("select exists")) return { rows: [{ exists: settings.activePickup }] };
    if (text.startsWith("update public.loans set return_operation")) { if (settings.dropPlanWrite) return { rows: [] }; state.loan.return_operation = JSON.parse(String(values[0])); return { rows: [{ id: loanId }] }; }
    if (text.includes("set returned_at")) { if (state.loan.returned_at) return { rows: [] }; state.loan.returned_at = values[0] as Date; return { rows: [{ id: loanId }] }; }
    if (text.includes("insert into public.condition_records")) { if (settings.historyFailure) throw new Error("Dummy private SQL insert failure"); state.records.push(values); return { rows: [] }; }
    if (text.includes("select item_id, due_date")) return { rows: values[0] === 7 && (values[1] as string[]).includes(itemId) && !state.loan.returned_at ? [{ item_id: itemId, due_date: state.loan.due_date, borrower_id: "must-not-leak" }] : [] };
    if (text.includes("from public.loans")) return { rows: values[0] === loanId && values[1] === 7 ? [structuredClone(state.loan)] : [] };
    if (text.includes("from public.condition_records")) return { rows: structuredClone(state.pickup) };
    return { rows: [] };
  }
  return { state, settings, sql, pool: pool as unknown as Pool };
}
