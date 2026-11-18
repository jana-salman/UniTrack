// @vitest-environment jsdom
// S2-09 handover page interaction tests: real React components -> Web gateway ->
// Loans -> Equipment handlers over localhost (databases/profile modeled).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fixture, borrowerName } from "./fixtures/handover-http";
import { reservationId, kitComponents } from "../../../services/loans/tests/fixtures/handover-db";
import HandoverDetails from "@/app/(protected)/handover/[reservationId]/handover-details";

// Each step drives several real localhost service hops (gateway -> Loans ->
// Users/Equipment). Allow for a loaded machine instead of Vitest's 5 s default,
// so one slow test cannot abandon in-flight requests into the next test.
vi.setConfig({ testTimeout: 30_000 });
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function waitForUi(assertion: () => void) {
  const deadline = Date.now() + 15_000;
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
const idBox = () => host.querySelector<HTMLInputElement>('input[name="university-id-verified"]')!;
/** The assistant's physical ID check (if not yet ticked) and the student's confirmation. */
async function confirmBoth() { if (!idBox().checked) await click(idBox()); await click(studentBox()); }
const submit = () => click(host.querySelector<HTMLButtonElement>('button[type="submit"]')!);
const loanPosts = () => fixture.requests.filter(r => r.service === "loans" && r.method === "POST");

it("TC-3.1: renders the main item plus the five actual components, and after ticks, Good and student confirmation shows Borrowed with borrower and due date", async () => {
  await open();
  expect(rows()).toHaveLength(6);
  expect(rows()[0].textContent).toContain(fixture.itemName + " (main item)");
  expect(host.querySelector('[data-testid="borrower-identity"]')?.textContent).toContain("Borrower verified: active student in your lab");
  for (const component of kitComponents) expect(host.textContent).toContain(component.name);
  expect(host.textContent).toContain(borrowerName);
  expect(host.textContent).toContain("Reserved");
  const options = [...rows()[0].querySelectorAll("option")].map(o => o.textContent);
  expect(options).toEqual(["Choose condition", "Good", "Existing damage", "Missing component", "Needs attention"]);
  for (const row of rows()) await fillRow(row);
  await confirmBoth();
  await submit();
  await waitForUi(() => expect(host.textContent).toContain("Handover complete"));
  expect(host.textContent).toContain("Equipment status: Borrowed");
  expect(host.textContent).toContain("University ID checked in person:");
  expect(host.textContent).toContain("Borrower: " + borrowerName);
  expect(host.textContent).toContain("Due: " + new Date(fixture.db.state.loans[0].due_date).toLocaleString());
  expect(fixture.status).toBe("checked_out"); expect(fixture.db.state.records).toHaveLength(6);
  expect(fixture.db.state.records.filter(r => r.kit_component_id === null)).toHaveLength(1);
});

it("renders a different component count dynamically", async () => {
  fixture.components = fixture.components.slice(0, 3);
  await open(); expect(rows()).toHaveLength(4);
  expect(host.textContent).toContain("Kit checklist (main item + 3 components)");
});

it("TC-3.4/TC-3.5: missing charger and existing damage are saved with notes, no photo control", async () => {
  await open();
  expect(host.querySelector('input[type="file"]')).toBeNull();
  const all = rows();
  await fillRow(all[0]); // main item: its own explicit condition
  await fillRow(all[1], "missing", "Charger not in the case");
  await fillRow(all[2]); await fillRow(all[3]);
  await fillRow(all[4], "damaged", "Scratched lid");
  await fillRow(all[5]);
  await confirmBoth(); await submit();
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
  await confirmBoth(); await submit();
  await waitForUi(() => expect(host.querySelector('[role="alert"]')?.textContent).toBe("Tick every row after checking it."));
  expect(loanPosts()).toHaveLength(0);
});

it("shows the main item for non-kit equipment", async () => {
  fixture.components = [];
  await open();
  expect(rows()).toHaveLength(1); expect(rows()[0].textContent).toContain(fixture.itemName);
  await fillRow(rows()[0], "damaged", "Dent on base");
  await confirmBoth(); await submit();
  await waitForUi(() => expect(host.textContent).toContain("Handover complete"));
  expect(fixture.db.state.records).toEqual([expect.objectContaining({ kit_component_id: null, condition_status: "damaged", notes: "Dent on base" })]);
});

it("uncertain outcome after an Equipment failure: clearly shown, no fresh submission, only recovery of the SAME operation", async () => {
  fixture.failEquipmentStatus = true;
  await open();
  const all = rows();
  await fillRow(all[0], "good", "first attempt");
  for (const row of all.slice(1)) await fillRow(row);
  await confirmBoth(); await submit();
  await waitForUi(() => expect(host.textContent).toContain("Handover not finished — outcome uncertain"));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("The handover result needs verification.");
  expect(host.textContent).toContain("A new handover cannot be started for this reservation until this one is finished or undone.");
  expect(host.querySelector("form")).toBeNull();
  expect(host.textContent).not.toContain("Handover complete");
  expect(fixture.db.state.loans).toHaveLength(0);
  fixture.failEquipmentStatus = false;
  await click([...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Finish interrupted handover")!);
  await waitForUi(() => expect(host.textContent).toContain("Handover complete"));
  expect(fixture.db.state.loans).toHaveLength(1); expect(fixture.history).toHaveLength(1);
  // The saved checklist (including the note) was used, not a new one.
  expect(fixture.db.state.records.find(r => r.kit_component_id === null)?.notes).toBe("first attempt");
});

it("uncertain outcome with no saved operation (lost connection): form locked, only the SAME information can be resent", async () => {
  await open();
  for (const row of rows()) await fillRow(row);
  await confirmBoth();
  const realFetch = globalThis.fetch;
  let dropped = false;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!dropped && init?.method === "POST") { dropped = true; throw new TypeError("network down"); }
    return realFetch(input, init);
  }));
  try {
    await submit();
    await waitForUi(() => expect(host.querySelector('[data-testid="handover-uncertain"]')?.textContent).toContain("Outcome not confirmed"));
    expect(host.querySelector("fieldset")!.disabled).toBe(true);
    await submit(); // a fresh submission is blocked while the outcome is unresolved
    expect(loanPosts()).toHaveLength(0);
    await click([...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Retry the same handover")!);
    await waitForUi(() => expect(host.textContent).toContain("Handover complete"));
    expect(loanPosts()).toHaveLength(1); expect(fixture.db.state.loans).toHaveLength(1);
  } finally { vi.stubGlobal("fetch", realFetch); }
});

it("a definite failure (borrower no longer an eligible student) is shown as not handed over, without the uncertain notice", async () => {
  await open();
  for (const row of rows()) await fillRow(row);
  await confirmBoth();
  fixture.borrowerActive = false;
  await submit();
  await waitForUi(() => expect(host.textContent).toContain("The borrower must be an active student in this lab, matching the reservation."));
  expect(host.querySelector('[data-testid="handover-uncertain"]')).toBeNull();
  expect(host.textContent).not.toContain("outcome uncertain");
  expect(fixture.db.state.loans).toHaveLength(0); expect(fixture.status).toBe("reserved"); expect(fixture.history).toHaveLength(0);
});

it("PO (JS): without the assistant's university-ID tick nothing is sent, even when the student confirmed", async () => {
  await open();
  expect(host.textContent).toContain("University ID check (lab assistant)");
  expect(host.querySelector('input[type="file"]')).toBeNull();
  expect(host.querySelector('input[type="text"], input[type="number"]')).toBeNull();
  for (const row of rows()) await fillRow(row);
  await click(studentBox()); await submit();
  await waitForUi(() => expect(host.querySelector('[role="alert"]')?.textContent).toBe("Check the student's university ID card in person and tick the ID check before completing the handover."));
  expect(loanPosts()).toHaveLength(0); expect(fixture.db.state.loans).toHaveLength(0);
  // The ID tick is separate and does not count as the student's confirmation either.
  await click(studentBox()); await click(idBox()); await submit();
  await waitForUi(() => expect(host.querySelector('[role="alert"]')?.textContent).toBe("The student must confirm the handover before it can be completed."));
  expect(loanPosts()).toHaveLength(0);
});

it("does not show a checklist when Equipment components are unavailable", async () => {
  fixture.failComponents = true;
  await act(async () => root.render(<HandoverDetails reservationId={reservationId} />));
  await waitForUi(() => expect(host.textContent).toContain("The equipment checklist is unavailable"));
  expect(host.querySelector("form")).toBeNull();
});

it("blocks the checklist when Users cannot verify the borrower (name shown is not verification)", async () => {
  fixture.borrowerActive = false;
  await act(async () => root.render(<HandoverDetails reservationId={reservationId} />));
  await waitForUi(() => expect(host.textContent).toContain("The borrower must be an active student in this lab, matching the reservation."));
  expect(host.textContent).toContain(borrowerName);
  expect(host.querySelector("form")).toBeNull();
});

it("an interrupted handover shows Finish interrupted handover, which completes it without re-entering anything", async () => {
  fixture.usersDownAfterCheckout = true;
  await open();
  for (const row of rows()) await fillRow(row);
  await confirmBoth(); await submit();
  // The unresolved operation replaces the form; the honest message stays visible.
  await waitForUi(() => expect(host.textContent).toContain("Handover not finished — outcome uncertain"));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("The equipment is checked out but the handover is not finished.");
  expect(host.querySelector("form")).toBeNull();
  expect(fixture.db.state.loans).toHaveLength(0);
  fixture.usersDown = false; fixture.usersDownAfterCheckout = false;
  // Fresh page load (e.g. another day / another browser): the durable plan is shown.
  await act(async () => root.unmount()); root = createRoot(host);
  await act(async () => root.render(<HandoverDetails reservationId={reservationId} />));
  await waitForUi(() => expect(host.textContent).toContain("Handover not finished"));
  expect(host.querySelector("form")).toBeNull();
  await click([...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Finish interrupted handover")!);
  await waitForUi(() => expect(host.textContent).toContain("Handover complete"));
  expect(host.textContent).toContain("Equipment status: Borrowed");
  expect(fixture.db.state.loans).toHaveLength(1); expect(fixture.db.state.records).toHaveLength(6); expect(fixture.history).toHaveLength(1);
});
it("A1: the student's confirmation explicitly lists each missing component with its note", async () => {
  await open();
  const all = rows();
  await fillRow(all[0]);
  await fillRow(all[1], "missing", "Charger not in the case");
  for (const row of all.slice(2)) await fillRow(row);
  const disclosure = host.querySelector('[data-testid="confirmation-missing"]');
  expect(disclosure?.textContent).toContain("Missing — not being handed over:");
  expect(disclosure?.textContent).toContain('Charger — "Charger not in the case"');
  expect(studentBox().closest("label")?.textContent).toContain("including the 1 missing item listed here");
  await confirmBoth(); await submit();
  await waitForUi(() => expect(host.textContent).toContain("Handover complete"));
  expect(fixture.db.state.records.find(r => r.kit_component_id === kitComponents[0].id)).toMatchObject({ condition_status: "missing", notes: "Charger not in the case" });
  expect(fixture.db.state.loans[0].student_confirmed_at).toBeInstanceOf(Date);
});

it("A1: existing damage and Needs attention are also shown to the student before confirming", async () => {
  await open();
  const all = rows();
  for (const row of all) await fillRow(row);
  await setValue(all[4].querySelector("select")!, "damaged");
  await setValue(all[4].querySelector("textarea")!, "Scratched lid");
  expect(host.querySelector('[data-testid="confirmation-problems"]')?.textContent).toContain('Case: Existing damage — "Scratched lid"');
});

it.each([
  ["a condition", async (all: HTMLElement[]) => setValue(all[2].querySelector("select")!, "missing")],
  ["a note", async (all: HTMLElement[]) => setValue(all[0].querySelector("textarea")!, "added after confirmation")],
  ["a tick", async (all: HTMLElement[]) => click(all[3].querySelector<HTMLInputElement>('input[type="checkbox"]')!)],
])("changing %s after confirmation clears it, blocks submission, and requires confirmation again", async (_name, change) => {
  await open();
  const all = rows();
  for (const row of all) await fillRow(row);
  await confirmBoth();
  expect(studentBox().checked).toBe(true);
  await change(all);
  expect(studentBox().checked).toBe(false);
  expect(host.textContent).toContain("The checklist changed after the student confirmed. The student must confirm again.");
  await submit();
  await waitForUi(() => expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy());
  expect(loanPosts()).toHaveLength(0); expect(fixture.db.state.loans).toHaveLength(0);
});

it("after reconfirming the changed checklist, the handover saves exactly what was reconfirmed", async () => {
  await open();
  const all = rows();
  for (const row of all) await fillRow(row);
  await confirmBoth();
  await setValue(all[1].querySelector("select")!, "missing");
  await setValue(all[1].querySelector("textarea")!, "Lost before pickup");
  expect(studentBox().checked).toBe(false);
  expect(host.querySelector('[data-testid="confirmation-missing"]')?.textContent).toContain('Charger — "Lost before pickup"');
  await confirmBoth(); await submit();
  await waitForUi(() => expect(host.textContent).toContain("Handover complete"));
  expect(fixture.db.state.records.find(r => r.kit_component_id === kitComponents[0].id)).toMatchObject({ condition_status: "missing", notes: "Lost before pickup" });
  expect(loanPosts()).toHaveLength(1);
});
