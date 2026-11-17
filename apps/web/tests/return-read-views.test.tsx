// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fixture, components } from "./fixtures/return-acceptance-http";
import { loanId, borrowerId, itemId } from "../../../services/loans/tests/fixtures/return-db";
import ReturnDetails from "@/app/(protected)/return/[loanId]/return-details";
import ReturnProblems from "@/app/(protected)/dashboard/return-problems";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function waitForUi(assertion: () => void) {
  const deadline = Date.now() + 4000; let failure: unknown;
  do { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); try { assertion(); return; } catch (error) { failure = error; } } while (Date.now() < deadline);
  throw failure;
}
async function renderReturn(key = "initial") {
  await act(async () => root.render(<ReturnDetails key={key} loanId={loanId} />));
  await waitForUi(() => expect(host.querySelector("form"), host.textContent ?? "").not.toBeNull());
}
async function finish(kind: "clean" | "missing" | "damage" = "clean", additionalDamage = false) {
  await renderReturn();
  const choices = [...host.querySelectorAll<HTMLSelectElement>("form select")];
  for (const [index, control] of choices.entries()) {
    const value = kind === "missing" && index === 1 ? "missing" : kind === "damage" && index === 0 ? "damaged" : "good";
    await act(async () => { control.value = value; control.dispatchEvent(new Event("change", { bubbles: true })); });
  }
  if (additionalDamage) await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  if (kind === "damage") {
    const notes = host.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(notes, "Broken casing"); notes.dispatchEvent(new Event("input", { bubbles: true })); });
  }
  await act(async () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
  await waitForUi(() => expect(host.textContent).toContain(fixture.loseApplyResponse ? "verification" : "Return saved"));
}
async function dashboard() {
  await act(async () => root.render(<ReturnProblems />));
  await waitForUi(() => expect(host.textContent).not.toContain("Loading return records..."));
}
const student = { kind: "user", sub: borrowerId, role: "student", lab_id: 7, rid: "student-history" } as const;

it("TC-4.1 reload shows persisted on-time history and all six conditions despite today's Equipment status", async () => {
  await finish(); const returnedAt = fixture.db.state.loan.returned_at!.toISOString();
  const replay = await fixture.confirmAgain(fixture.posts[0]); expect(replay.status).toBe(200);
  expect((await replay.json()).returnedAt).toBe(returnedAt);
  const operation = JSON.stringify(fixture.db.state.loan.return_operation);
  fixture.status = "under_maintenance";
  await act(async () => root.render(<ReturnDetails key="history" loanId={loanId} />));
  await waitForUi(() => expect(host.querySelector('[aria-labelledby="return-history-heading"]')).not.toBeNull());
  const history = host.querySelector('[aria-labelledby="return-history-heading"]')!;
  expect(history.textContent).toContain("On-time return"); expect(history.textContent).not.toContain("Late return");
  expect(history.querySelector('time[datetime="' + returnedAt + '"]')).not.toBeNull();
  expect(history.querySelectorAll("li")).toHaveLength(6);
  for (const component of components) expect(history.textContent).toContain(component.component_name);
  expect([...history.querySelectorAll("li")].every(row => row.textContent?.includes("Good"))).toBe(true);
  expect(host.querySelector("form")).toBeNull(); expect(fixture.history).toHaveLength(1);
  expect(JSON.stringify(fixture.db.state.loan.return_operation)).toBe(operation);
  const persisted = await (await fetch("/api/returns/" + loanId)).json();
  expect(persisted.returnHistory.conditions).toHaveLength(6);
  expect(persisted.returnHistory.isLate).toBe(false);
  expect(persisted.loan).not.toHaveProperty("return_operation");
});

it("completed assistant history displays late return and actual recorded damage/notes", async () => {
  fixture.db.state.loan.due_date = new Date("2001-01-01");
  await finish("damage", true); fixture.status = "available";
  await act(async () => root.render(<ReturnDetails key="late-history" loanId={loanId} />));
  await waitForUi(() => expect(host.textContent).toContain("Late return"));
  const history = host.querySelector('[aria-labelledby="return-history-heading"]')!;
  expect(history.textContent).toContain("Damaged"); expect(history.textContent).toContain("Broken casing");
  expect(history.textContent).not.toContain("On-time return");
  expect(history.querySelector("time")?.getAttribute("datetime")).toBe(fixture.db.state.loan.returned_at!.toISOString());
});

it("TC-4.2 student dashboard identifies the persisted missing Charger through Equipment labels", async () => {
  await finish("missing"); const operation = JSON.stringify(fixture.db.state.loan.return_operation);
  const count = fixture.db.state.records.length; fixture.asStudent(); await dashboard();
  expect(host.textContent).toContain(fixture.name); expect(host.textContent).toContain("Charger: Missing at return");
  expect(host.textContent).not.toContain("Fixture borrower");
  const response = await fixture.readMine("?borrowerId=forged&labId=999"); expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  const data = await response.json(); expect(data.returns).toHaveLength(1);
  expect(data.returns[0].problems).toEqual([{ componentId: components[0].id, kind: "missing", notes: null, label: "Charger" }]);
  expect(Object.keys(data.returns[0]).sort()).toEqual(["itemId", "itemName", "loanId", "problems", "returnedAt"]);
  expect(JSON.stringify(data)).not.toMatch(/return_operation|fingerprint|borrower_id|request_key/);
  expect(fixture.requests.some(r => r.path === "equipment/items/" + itemId + "/component-labels" && r.identity?.sub === borrowerId)).toBe(true);
  expect(fixture.db.state.records).toHaveLength(count); expect(fixture.history).toHaveLength(1);
  expect(JSON.stringify(fixture.db.state.loan.return_operation)).toBe(operation);
});

it("TC-4.3 own dashboard shows new damage compared with Good pickup, not current item status", async () => {
  fixture.name = "Sensor"; fixture.components = []; fixture.db.state.pickup.splice(1);
  await finish("damage"); // no checkbox: persisted Good -> Damaged comparison is enough
  fixture.status = "available"; fixture.asStudent(); await dashboard();
  expect(host.textContent).toContain("Sensor"); expect(host.textContent).toContain("Main item: New or additional damage at return");
  expect(host.textContent).toContain("Broken casing"); expect(host.textContent).not.toContain("No missing items");
});

it("unchanged existing damage is not shown as a new return problem", async () => {
  fixture.db.state.pickup[0].condition_status = "damaged";
  await finish("damage"); fixture.asStudent(); await dashboard();
  expect(host.textContent).toContain("No missing items or new damage recorded for your completed returns.");
  expect((await (await fixture.readMine()).json()).returns).toEqual([]);
});

it("an explicit additional-damage marker on existing damage is shown with cleaned notes", async () => {
  fixture.db.state.pickup[0].condition_status = "damaged";
  await finish("damage", true); fixture.asStudent(); await dashboard();
  expect(host.textContent).toContain("New or additional damage at return"); expect(host.textContent).toContain("Broken casing");
  const record = (await (await fixture.readMine()).json()).returns[0];
  expect(record.problems[0].notes).toBe("Broken casing");
});

it("a different student cannot request the original borrower's completed problems", async () => {
  await finish("missing");
  const otherId = "550e8400-e29b-41d4-a716-446655440099";
  fixture.asStudent({ id: otherId });
  const response = await fixture.readMine("?borrowerId=" + borrowerId + "&labId=7");
  expect(response.status).toBe(200); expect((await response.json()).returns).toEqual([]);
  const query = fixture.db.sql.at(-1)!; expect(query.text).toContain("borrower_id = $1 and lab_id = $2"); expect(query.values).toEqual([otherId, 7]);
});

it("the borrower identity cannot read the same loan under another lab", async () => {
  await finish("missing"); fixture.asStudent({ lab_id: 8 });
  expect((await (await fixture.readMine("?labId=7")).json()).returns).toEqual([]);
  expect(await (await fixture.directMine({ ...student, lab_id: 8 })).json()).toEqual([]);
  expect(fixture.db.sql.at(-1)?.values).toEqual([borrowerId, 8]);
});

it("open loans are omitted even if uncommitted return conditions are present in a fixture", async () => {
  fixture.db.state.records.push([loanId, itemId, components[0].id, 7, "missing", null, "actor", new Date()]);
  fixture.asStudent(); await dashboard();
  expect(host.textContent).toContain("No missing items or new damage recorded"); expect(fixture.db.state.loan.returned_at).toBeNull();
});

it("the actual Loans own-return endpoint rejects missing/bad tokens, service identities and non-students", async () => {
  expect((await fixture.directMine()).status).toBe(401); expect((await fixture.directMine("invalid-token")).status).toBe(401);
  expect((await fixture.directMine({ ...student, role: "lab_assistant" })).status).toBe(403);
  expect((await fixture.directMine({ kind: "service", sub: "gateway", role: "service", lab_id: null, rid: "service" })).status).toBe(403);
  expect((await fixture.readMine()).status).toBe(403); // Web verified profile is still assistant
});

it("approved student component labels expose only IDs/names and preserve lab restrictions", async () => {
  fixture.components = fixture.components.map(c => ({ ...c, tracked_item_id: itemId, quantity_required: 99 }));
  const response = await fixture.directLabels(student); expect(response.status).toBe(200);
  expect(await response.json()).toEqual(components);
  expect((await fixture.directLabels({ ...student, lab_id: 8 })).status).toBe(404);
});

it("label failure preserves a student's recorded problem and displays a partial-data notice", async () => {
  await finish("missing"); fixture.labelsUnavailable = true; fixture.asStudent(); await dashboard();
  expect(host.textContent).toContain("Some equipment or component labels are unavailable.");
  expect(host.textContent).toContain("Component label unavailable: Missing at return"); expect(host.textContent).toContain(fixture.name);
  expect(host.textContent).not.toContain("No missing items");
});

it("student permission does not grant access to the assistant's full return history endpoint", async () => {
  await finish("missing"); fixture.asStudent();
  const response = await fetch("/api/returns/" + loanId);
  expect(response.status).toBe(403); expect(await response.text()).not.toMatch(/return_operation|Fixture borrower|Broken casing/);
});

it("gateway projections discard unexpected internal and other-borrower fields on all return responses", async () => {
  fixture.extraPayloadFields = true; await finish("missing");
  const replay = await (await fixture.confirmAgain(fixture.posts[0])).json();
  expect(Object.keys(replay).sort()).toEqual(["isLate", "loanId", "returnedAt", "status"]);
  const details = await (await fetch("/api/returns/" + loanId)).json();
  expect(details.returnHistory.conditions).toHaveLength(6);
  expect(JSON.stringify(details)).not.toMatch(/return_operation|other_borrower|unapproved-metadata/);
  fixture.asStudent(); const own = await (await fixture.readMine()).json();
  expect(own.returns[0].problems[0].label).toBe("Charger");
  expect(JSON.stringify(own)).not.toMatch(/return_operation|other_borrower|unapproved-metadata/);
  expect(fixture.db.state.records).toHaveLength(6); expect(fixture.history).toHaveLength(1);
});

it.each(["", "http://127.0.0.1:1"])("invalid/offline Equipment origin preserves assistant history and student problems (%s)", async baseUrl => {
  await finish("missing"); vi.stubEnv("EQUIPMENT_SERVICE_URL", baseUrl);
  await act(async () => root.render(<ReturnDetails key="labels-down" loanId={loanId} />));
  await waitForUi(() => expect(host.textContent).toContain("Return history"));
  expect(host.textContent).toContain("On-time return"); expect(host.textContent).toContain("Missing");
  expect(host.textContent).toContain("Some equipment labels or the borrower name are unavailable.");
  fixture.asStudent(); await dashboard();
  expect(host.textContent).toContain("Equipment label unavailable"); expect(host.textContent).toContain("Missing at return");
  expect(host.textContent).toContain("Some equipment or component labels are unavailable.");
  expect(host.textContent).not.toContain("No missing items");
});

it("component labels reject unauthenticated/service callers and do not open the staff metadata endpoint", async () => {
  expect((await fixture.directLabels()).status).toBe(401);
  expect((await fixture.directLabels("invalid-token")).status).toBe(401);
  expect((await fixture.directLabels({ kind: "service", sub: "gateway", role: "service", lab_id: null, rid: "service-labels" })).status).toBe(403);
  expect((await fixture.directLabels(student, true)).status).toBe(403);
});
