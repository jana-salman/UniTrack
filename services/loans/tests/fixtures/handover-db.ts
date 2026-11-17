// In-memory transaction/lock MODEL for S2-09 handover tests. Synthetic rows only.
// No SQL is executed; this is not PostgreSQL proof (see the local-database test).
import type { Pool } from "pg";

export const reservationId = "7c9e6679-7425-40de-944b-e07fc1f90001";
export const kitItemId = "7c9e6679-7425-40de-944b-e07fc1f90002";
export const assistantId = "7c9e6679-7425-40de-944b-e07fc1f90003";
export const borrowerId = "7c9e6679-7425-40de-944b-e07fc1f90004";
export const otherLoanId = "7c9e6679-7425-40de-944b-e07fc1f90005";
export const labId = 7;
/** Five-component fixture for TC-3.1. Code never assumes five. */
export const kitComponents = ["Charger", "Cable", "Battery", "Case", "Tripod"].map((name, index) => ({
  id: "7c9e6679-7425-40de-944b-e07fc1f900a" + index, name, isActive: true, isRequired: true,
}));
export const chargerId = kitComponents[0].id;

export interface LoanRow {
  id: string; item_id: string; borrower_id: string; reservation_id: string | null; lab_id: number;
  borrowed_at: Date; due_date: Date; student_confirmed_at: Date | null; returned_at: Date | null;
}
export interface RecordRow {
  id: string; loan_id: string; item_id: string; kit_component_id: string | null; lab_id: number;
  phase: string; condition_status: string; notes: string | null; recorded_by: string; recorded_at: Date;
}

export function handoverDatabase() {
  const hour = 3600_000;
  const state = {
    reservation: {
      id: reservationId, item_id: kitItemId, borrower_id: borrowerId, lab_id: labId,
      start_at: new Date(Date.now() - hour), end_at: new Date(Date.now() + 7 * 24 * hour),
      status: "confirmed", handover_operation: null as unknown,
    },
    loans: [] as LoanRow[],
    records: [] as RecordRow[],
    /** Other reservations (any item) for overlap/eligibility tests. */
    otherReservations: [] as { id: string; item_id: string; status: string; start_at: Date; end_at: Date }[],
  };
  const settings = {
    loanFailure: false, recordFailure: false, dropPlanWrite: false, rollbackFailure: false, legacyLoanAfterRollback: false,
    commitFailure: "" as "" | "before" | "after",
    planCommitFailure: "" as "" | "before" | "after",
    compensationCommitFailure: "" as "" | "before" | "after",
    /** Runs once, just before the final transaction's eligibility check. */
    beforeFinalCheck: null as null | (() => void),
  };
  let locked = false;
  const sql: { text: string; values: unknown[] }[] = [];
  const operationState = () => (state.reservation.handover_operation as { state?: string } | null)?.state;

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
          if (text === "ROLLBACK") {
            if (settings.rollbackFailure) throw new Error("Dummy rollback connection loss");
            if (snapshot) Object.assign(state, snapshot);
            snapshot = undefined;
            if (settings.legacyLoanAfterRollback) state.loans.push({ id: otherLoanId, item_id: kitItemId, borrower_id: borrowerId, reservation_id: reservationId, lab_id: labId, borrowed_at: new Date(), due_date: state.reservation.end_at, student_confirmed_at: null, returned_at: null });
          }
          if (text === "COMMIT") {
            const finalWrite = !!snapshot && state.loans.length > snapshot.loans.length;
            const special = finalWrite ? "commitFailure" : operationState() === "compensated" ? "compensationCommitFailure" : operationState() === "planned" ? "planCommitFailure" : undefined;
            if (special && settings[special]) {
              const mode = settings[special]; settings[special] = "";
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
    const r = state.reservation;
    if (text.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (text.includes("count(*)::int as count from public.reservations")) {
      const [item, at] = values as [string, Date];
      const all = [r, ...state.otherReservations];
      return { rows: [{ count: all.filter(x => x.item_id === item && x.status === "confirmed" && x.start_at <= at && x.end_at > at).length }] };
    }
    if (text.includes("count(*)::int as count from public.loans where item_id = $1 and returned_at is null")) {
      return { rows: [{ count: state.loans.filter(l => l.item_id === values[0] && !l.returned_at).length }] };
    }
    if (text.includes("from public.reservations")) {
      if (values[0] !== r.id || values[1] !== r.lab_id) return { rows: [] };
      return { rows: [{ ...structuredClone(r), operation_state: operationState() ?? null }] };
    }
    if (text.startsWith("update public.reservations set handover_operation")) {
      if (settings.dropPlanWrite || values[1] !== r.id || values[2] !== r.lab_id) return { rows: [] };
      r.handover_operation = JSON.parse(String(values[0]));
      // The "applied" write is autocommitted after Equipment checkout and before
      // the final transaction: model another writer's COMMITTED change there.
      if (operationState() === "applied" && settings.beforeFinalCheck) { const hook = settings.beforeFinalCheck; settings.beforeFinalCheck = null; hook(); }
      return { rows: [{ id: r.id }] };
    }
    if (text.includes("from public.loans where reservation_id = $1 or id = $2")) return { rows: state.loans.filter(l => l.reservation_id === values[0] || l.id === values[1]).map(l => ({ id: l.id })) };
    if (text.includes("from public.loans") && text.includes("reservation_id = $1 and lab_id = $2")) return { rows: structuredClone(state.loans.filter(l => l.reservation_id === values[0] && l.lab_id === values[1])) };
    if (text.includes("from public.loans where reservation_id = $1")) return { rows: state.loans.filter(l => l.reservation_id === values[0]).map(l => ({ id: l.id })) };
    if (text.includes("from public.loans where item_id = $1 and returned_at is null")) return { rows: state.loans.filter(l => l.item_id === values[0] && !l.returned_at).map(l => ({ id: l.id })) };
    if (text.includes("insert into public.loans")) {
      if (settings.loanFailure) throw new Error("Dummy private loan insert failure");
      const [id, item_id, borrower_id, reservation_id, lab_id, borrowed_at, due_date, student_confirmed_at] = values as [string, string, string, string, number, string, string, string];
      // Model the reservation_id UNIQUE and loans_one_active_per_item indexes.
      if (state.loans.some(l => l.reservation_id === reservation_id || (l.item_id === item_id && !l.returned_at))) throw Object.assign(new Error("duplicate key"), { code: "23505" });
      state.loans.push({ id, item_id, borrower_id, reservation_id, lab_id, borrowed_at: new Date(borrowed_at), due_date: new Date(due_date), student_confirmed_at: new Date(student_confirmed_at), returned_at: null });
      return { rows: [{ id }] };
    }
    if (text.includes("insert into public.condition_records")) {
      if (settings.recordFailure) throw new Error("Dummy private condition insert failure");
      const [loan_id, item_id, kit_component_id, lab_id, condition_status, notes, recorded_by, recorded_at] = values as [string, string, string | null, number, string, string | null, string, string];
      state.records.push({ id: "7c9e6679-7425-40de-944b-" + String(state.records.length + 1).padStart(12, "0"), loan_id, item_id, kit_component_id, lab_id, phase: text.includes("'pickup'") ? "pickup" : "?", condition_status, notes, recorded_by, recorded_at: new Date(recorded_at) });
      return { rows: [] };
    }
    if (text.includes("from public.condition_records")) {
      return { rows: state.records.filter(c => c.loan_id === values[0] && c.item_id === values[1] && c.lab_id === values[2] && c.phase === "pickup").map(c => ({ id: c.id, kit_component_id: c.kit_component_id, condition_status: c.condition_status, notes: c.notes })) };
    }
    return { rows: [] };
  }
  return { state, settings, sql, pool: pool as unknown as Pool };
}

/** Ticked, Good rows for the given component IDs (or the main item when empty). */
export function goodChecklist(ids: readonly string[] = kitComponents.map(c => c.id)) {
  return ids.length
    ? ids.map(kitComponentId => ({ kitComponentId, checked: true, conditionStatus: "good", notes: "" }))
    : [{ kitComponentId: null, checked: true, conditionStatus: "good", notes: "" }];
}
