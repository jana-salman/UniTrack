// S2-09 / C430PRJCT-40: Web gateway -> Loans -> Equipment over real localhost HTTP.
import { describe, expect, it } from "vitest";
import { fixture, routes, borrowerName, assistant, secret } from "./fixtures/handover-http";
import { reservationId, kitItemId, assistantId, borrowerId, kitComponents } from "../../../services/loans/tests/fixtures/handover-db";
const { GET, POST } = routes;
import { AuthorizationError } from "@/lib/auth/errors";

const checklist = (change: (row: { kitComponentId: string | null; checked: boolean; conditionStatus: string; notes: string }, index: number) => object = row => row) =>
  kitComponents.map((c, index) => change({ kitComponentId: c.id, checked: true, conditionStatus: "good", notes: "" }, index));
const confirmBody = (conditions = checklist(), studentConfirmed = true) => ({ studentConfirmed, conditions });
const post = (body: unknown, headers?: Record<string, string>) => POST(fixture.browser("POST", body, headers), fixture.context());
const view = async () => (await GET(fixture.browser("GET"), fixture.context())).json();

describe("handover gateway", () => {
  it("shows reservation, equipment, borrower, due date and the actual components from the owning services", async () => {
    const response = await GET(fixture.browser("GET"), fixture.context());
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toContain("no-store");
    const data = await response.json();
    expect(data).toMatchObject({
      reservation: { id: reservationId, itemId: kitItemId, borrowerId, status: "confirmed", endAt: fixture.db.state.reservation.end_at.toISOString() },
      equipment: { name: "Five-component camera kit", assetCode: "KIT-HO-1", status: "reserved" },
      borrower: { name: borrowerName }, handover: null, pendingOperation: false,
    });
    expect(data.components).toEqual(kitComponents.map(c => ({ id: c.id, name: c.name, required: true })));
    expect(data.partialData).toBeUndefined();
  });

  it("TC-3.1: five Good components + student confirmation -> Borrowed with borrower and due date", async () => {
    const response = await post(confirmBody());
    expect(response.status).toBe(200);
    const outcome = await response.json();
    expect(outcome).toMatchObject({ reservationId, itemId: kitItemId, borrowerId, status: "checked_out", dueDate: fixture.db.state.reservation.end_at.toISOString() });
    expect(fixture.status).toBe("checked_out");
    expect(fixture.history).toEqual([expect.objectContaining({ old_status: "reserved", new_status: "checked_out", changed_by: assistantId, request_key: expect.stringMatching(/^handover:.+:0:apply$/) })]);
    expect(fixture.db.state.loans).toHaveLength(1);
    expect(fixture.db.state.records.map(r => r.kit_component_id).sort()).toEqual(kitComponents.map(c => c.id).sort());
    const after = await view();
    expect(after.equipment.status).toBe("checked_out");
    expect(after.handover).toMatchObject({ loanId: outcome.loanId, dueDate: outcome.dueDate, studentConfirmedAt: outcome.studentConfirmedAt });
    expect(after.borrower.name).toBe(borrowerName);
    expect(after.handover.pickupConditions).toHaveLength(5);
    // Every internal hop carried the verified assistant identity, never browser claims.
    expect(fixture.requests.every(r => r.identity?.sub === assistantId && r.identity.role === "lab_assistant" && r.identity.lab_id === 7)).toBe(true);
  });

  it("TC-3.4 and TC-3.5: missing charger and existing damage keep their notes through the gateway", async () => {
    const response = await post(confirmBody(checklist((row, i) => i === 0 ? { ...row, conditionStatus: "missing", notes: "Charger not in the case" } : i === 3 ? { ...row, conditionStatus: "damaged", notes: "Scratched lid" } : row)));
    expect(response.status).toBe(200);
    const pickup = (await view()).handover.pickupConditions;
    expect(pickup.find((p: { kitComponentId: string }) => p.kitComponentId === kitComponents[0].id)).toMatchObject({ conditionStatus: "missing", notes: "Charger not in the case" });
    expect(pickup.find((p: { kitComponentId: string }) => p.kitComponentId === kitComponents[3].id)).toMatchObject({ conditionStatus: "damaged", notes: "Scratched lid" });
  });

  it("TC-3.7: without student confirmation the item stays Reserved and no loan is saved", async () => {
    const response = await post(confirmBody(checklist(), false));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "student_confirmation_required", error: "The student must confirm the handover before it can be completed." });
    expect(fixture.status).toBe("reserved"); expect(fixture.history).toHaveLength(0);
    expect(fixture.db.state.loans).toHaveLength(0); expect(fixture.db.state.records).toHaveLength(0);
    expect(fixture.requests.filter(r => r.service === "equipment")).toHaveLength(0);
    expect((await view()).equipment.status).toBe("reserved");
  });

  it("non-kit equipment shows the main item and saves its record with kit_component_id null", async () => {
    fixture.components = [];
    expect((await view()).components).toEqual([]);
    const response = await post(confirmBody([{ kitComponentId: null, checked: true, conditionStatus: "good", notes: "" }] as never));
    expect(response.status).toBe(200);
    expect(fixture.db.state.records).toEqual([expect.objectContaining({ kit_component_id: null, phase: "pickup" })]);
  });

  it("relays approved validation messages for incomplete or unticked checklists", async () => {
    const incomplete = await post(confirmBody(checklist().slice(0, 4) as never));
    expect(incomplete.status).toBe(409); expect((await incomplete.json()).error).toBe("Check every kit component listed for this equipment.");
    const unticked = await post(confirmBody(checklist((row, i) => i === 1 ? { ...row, checked: false } : row)));
    expect((await unticked.json()).error).toBe("Tick every row after checking it.");
    const malformed = await POST(new Request("http://web.test/api/handover/" + reservationId, { method: "POST", body: "{" }), fixture.context());
    expect(malformed.status).toBe(400);
    expect(fixture.db.state.loans).toHaveLength(0); expect(fixture.status).toBe("reserved");
  });

  it("replays a double submission without a second loan or checkout", async () => {
    const [a, b] = await Promise.all([post(confirmBody()), post(confirmBody())]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200); expect([200, 409]).toContain(statuses[1]);
    const again = await post(confirmBody()); expect(again.status).toBe(200);
    expect(fixture.db.state.loans).toHaveLength(1); expect(fixture.history).toHaveLength(1);
  });
});

describe("server-side authorization", () => {
  it.each(["student", "professor", "lab_manager"])("Web rejects %s before contacting any service", async role => {
    fixture.asRole(role);
    expect((await GET(fixture.browser("GET"), fixture.context())).status).toBe(403);
    expect((await post(confirmBody())).status).toBe(403);
    expect(fixture.requests).toHaveLength(0); expect(fixture.db.sql).toHaveLength(0);
  });
  it("Web fails closed without a verified session and ignores forged browser identity headers", async () => {
    fixture.profile.mockRejectedValueOnce(new AuthorizationError(401, "unauthenticated", "Sign in is required."));
    expect((await GET(fixture.browser("GET"), fixture.context())).status).toBe(401);
    fixture.asRole("student");
    expect((await post(confirmBody(), { Authorization: "Bearer forged", "X-Role": "lab_assistant", "X-Lab-Id": "7" })).status).toBe(403);
    expect(fixture.db.state.loans).toHaveLength(0);
  });
  it("rejects a cross-origin POST", async () => {
    expect((await post(confirmBody(), { Origin: "http://attacker.test" })).status).toBe(403); expect(fixture.db.state.loans).toHaveLength(0);
  });
  it("Loans independently rejects other roles, missing tokens and other labs even if Web is bypassed", async () => {
    const base = { kind: "user" as const, sub: assistantId, role: "lab_assistant" as const, lab_id: 7, rid: "direct" };
    for (const role of ["student", "professor", "lab_manager"] as const) {
      expect((await fixture.direct("/handover/" + reservationId, { ...base, role }, "POST", confirmBody())).status).toBe(403);
    }
    expect((await fixture.direct("/handover/" + reservationId, null)).status).toBe(401);
    expect((await fixture.direct("/handover/" + reservationId, { ...base, lab_id: 8 })).status).toBe(404);
    expect(fixture.db.state.loans).toHaveLength(0); expect(fixture.status).toBe("reserved");
  });
});

describe("Equipment failures and recovery across the boundary", () => {
  it("Equipment outage: no loan, sanitized uncertain error, then the same information completes", async () => {
    fixture.failEquipmentStatus = true;
    const failed = await post(confirmBody());
    expect(failed.status).toBe(503);
    const body = await failed.text();
    expect(JSON.parse(body).code).toBe("handover_state_uncertain"); expect(body).not.toContain(secret);
    expect(fixture.db.state.loans).toHaveLength(0); expect((await view()).pendingOperation).toBe(true);
    fixture.failEquipmentStatus = false;
    expect((await post(confirmBody())).status).toBe(200);
    expect(fixture.db.state.loans).toHaveLength(1);
  });
  it("lost Equipment response after commit: not reported as success; retry replays the same key", async () => {
    fixture.loseApplyResponse = true;
    expect((await post(confirmBody())).status).toBe(503);
    expect(fixture.status).toBe("checked_out"); expect(fixture.db.state.loans).toHaveLength(0);
    expect((await post(confirmBody())).status).toBe(200);
    const keys = fixture.requests.filter(r => r.service === "equipment" && r.method === "PATCH");
    expect(keys).toHaveLength(2); expect(fixture.history).toHaveLength(1); expect(fixture.db.state.loans).toHaveLength(1);
  });
  it("local record failure restores Reserved through Equipment and reports rolled back", async () => {
    fixture.db.settings.recordFailure = true;
    const failed = await post(confirmBody());
    expect(failed.status).toBe(503); expect((await failed.json()).code).toBe("handover_rolled_back");
    expect(fixture.status).toBe("reserved"); expect(fixture.db.state.loans).toHaveLength(0);
    expect(fixture.history.map(h => h.new_status)).toEqual(["checked_out", "reserved"]);
  });
  it("blocks the checklist when Equipment components are unavailable instead of guessing", async () => {
    fixture.failComponents = true;
    const data = await view();
    expect(data.components).toBeNull(); expect(data.partialData).toBe(true);
  });
  it("uses only verified profile claims for every internal call", async () => {
    await post(confirmBody());
    expect(fixture.requests.length).toBeGreaterThan(3);
    expect(fixture.requests.every(r => r.identity?.kind === "user" && r.identity.sub === assistant.id)).toBe(true);
  });
});
