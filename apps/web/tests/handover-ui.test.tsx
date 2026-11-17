// @vitest-environment jsdom
// S2-09 handover page interaction tests: real React components -> Web gateway ->
// Loans -> Equipment handlers over localhost (databases/profile modeled).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { fixture, borrowerName } from "./fixtures/handover-http";
import { reservationId, kitComponents } from "../../../services/loans/tests/fixtures/handover-db";
import HandoverDetails from "@/app/(protected)/handover/[reservationId]/handover-details";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function waitForUi(assertion: () => void) {
  const deadline = Date.now() + 4000;
  let failure: unknown;
  do {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    try { assertion(); return; } catch (error) { failure = error; }
  } while (Date.now() < deadline);
  throw failure;
}
async function open() {
  await act(async () => root.render(<HandoverDetails reservationId={reservationId} />));
  await waitForUi(() => expect(host.querySelector("form"), host.textContent ?? "").not.toBeNull());
}
const rows = () => [...host.querySelectorAll<HTMLElement>('[data-testid="handover-row"]')];
async function setValue(control: HTMLSelectElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), "value")!.set!;
    setter.call(control, value);
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
async function click(element: HTMLElement) { await act(async () => element.click()); }
async function fillRow(row: HTMLElement, condition = "good", note = "") {
  await click(row.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  await setValue(row.querySelector("select")!, condition);
  if (note) await setValue(row.querySelector("textarea")!, note);
}
const studentBox = () => host.querySelector<HTMLInputElement>('input[name="student-confirmed"]')!;
const submit = () => click(host.querySelector<HTMLButtonElement>('button[type="submit"]')!);
const loanPosts = () => fixture.requests.filter(r => r.service === "loans" && r.method === "POST");

it("TC-3.1: renders the five actual components, and after ticks, Good and student confirmation shows Borrowed with borrower and due date", async () => {
  await open();
  expect(rows()).toHaveLength(5);
  for (const component of kitComponents) expect(host.textContent).toContain(component.name);
  expect(host.textContent).toContain(borrowerName);
  expect(host.textContent).toContain("Reserved");
  const options = [...rows()[0].querySelectorAll("option")].map(o => o.textContent);
  expect(options).toEqual(["Choose condition", "Good", "Existing damage", "Missing component", "Needs attention"]);
  for (const row of rows()) await fillRow(row);
  await click(studentBox());
  await submit();
  await waitForUi(() => expect(host.textContent).toContain("Handover complete"));
  expect(host.textContent).toContain("Equipment status: Borrowed");
  expect(host.textContent).toContain("Borrower: " + borrowerName);
  expect(host.textContent).toContain("Due: " + new Date(fixture.db.state.loans[0].due_date).toLocaleString());
  expect(fixture.status).toBe("checked_out"); expect(fixture.db.state.records).toHaveLength(5);
});

it("renders a different component count dynamically", async () => {
  fixture.components = fixture.components.slice(0, 3);
  await open(); expect(rows()).toHaveLength(3);
  expect(host.textContent).toContain("Kit checklist (3 components)");
});

it("TC-3.4/TC-3.5: missing charger and existing damage are saved with notes, no photo control", async () => {
  await open();
  expect(host.querySelector('input[type="file"]')).toBeNull();
  const all = rows();
  await fillRow(all[0], "missing", "Charger not in the case");
  await fillRow(all[1]); await fillRow(all[2]);
  await fillRow(all[3], "damaged", "Scratched lid");
  await fillRow(all[4]);
  await click(studentBox()); await submit();
  await waitForUi(() => expect(host.textContent).toContain("Handover complete"));
  expect(host.textContent).toContain("Missing component"); expect(host.textContent).toContain("Charger not in the case");
  expect(host.textContent).toContain("Existing damage"); expect(host.textContent).toContain("Scratched lid");
  expect(fixture.db.state.records.find(r => r.kit_component_id === kitComponents[0].id)).toMatchObject({ condition_status: "missing", notes: "Charger not in the case" });
});

it("TC-3.7: without the student's tick nothing is sent, the item stays Reserved and no loan is saved", async () => {
  await open();
  for (const row of rows()) await fillRow(row);
  await submit();
  await waitForUi(() => expect(host.querySelector('[role="alert"]')?.textContent).toBe("The student must confirm the handover before it can be completed."));
  expect(loanPosts()).toHaveLength(0);
  expect(fixture.status).toBe("reserved"); expect(fixture.db.state.loans).toHaveLength(0);
  expect(host.textContent).not.toContain("Handover complete");
});

it("requires every row to be ticked and given a condition before sending", async () => {
  await open();
  await fillRow(rows()[0]);
  await click(studentBox()); await submit();
  await waitForUi(() => expect(host.querySelector('[role="alert"]')?.textContent).toBe("Tick every row after checking it."));
  expect(loanPosts()).toHaveLength(0);
});

it("shows the main item for non-kit equipment", async () => {
  fixture.components = [];
  await open();
  expect(rows()).toHaveLength(1); expect(rows()[0].textContent).toContain(fixture.itemName);
  await fillRow(rows()[0], "damaged", "Dent on base");
  await click(studentBox()); await submit();
  await waitForUi(() => expect(host.textContent).toContain("Handover complete"));
  expect(fixture.db.state.records).toEqual([expect.objectContaining({ kit_component_id: null, condition_status: "damaged", notes: "Dent on base" })]);
});

it("after an Equipment failure, locks the form and retries only the same information", async () => {
  fixture.failEquipmentStatus = true;
  await open();
  for (const row of rows()) await fillRow(row);
  await click(studentBox()); await submit();
  await waitForUi(() => expect(host.textContent).toContain("Retry the same handover"));
  expect(host.textContent).not.toContain("Handover complete");
  expect(host.querySelector("fieldset")!.disabled).toBe(true);
  expect(fixture.db.state.loans).toHaveLength(0);
  fixture.failEquipmentStatus = false;
  await click([...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Retry the same handover")!);
  await waitForUi(() => expect(host.textContent).toContain("Handover complete"));
  expect(fixture.db.state.loans).toHaveLength(1); expect(fixture.history).toHaveLength(1);
});

it("does not show a checklist when Equipment components are unavailable", async () => {
  fixture.failComponents = true;
  await act(async () => root.render(<HandoverDetails reservationId={reservationId} />));
  await waitForUi(() => expect(host.textContent).toContain("The equipment checklist is unavailable"));
  expect(host.querySelector("form")).toBeNull();
});
