// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fixture, components } from "./fixtures/return-acceptance-http";
import { loanId, itemId, actorId } from "../../../services/loans/tests/fixtures/return-db";
import ReturnDetails from "@/app/(protected)/return/[loanId]/return-details";
import CatalogueClient from "@/components/CatalogueClient";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {} }) }));

let host: HTMLDivElement, root: Root;
let releaseConfirmation: (() => void) | undefined;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { releaseConfirmation?.(); releaseConfirmation = undefined; await act(async () => root.unmount()); host.remove(); });

async function waitForUi(assertion: () => void) {
  const deadline = Date.now() + 4000;
  let failure: unknown;
  do {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    try { assertion(); return; } catch (error) { failure = error; }
  } while (Date.now() < deadline);
  throw failure;
}
async function openReturn() {
  await act(async () => root.render(<ReturnDetails loanId={loanId} />));
  await waitForUi(() => expect(host.querySelector("form"), host.textContent ?? "").not.toBeNull());
}
function conditionControls() { return [...host.querySelectorAll<HTMLSelectElement>("form select")]; }
async function choose(control: HTMLSelectElement, value: string) {
  await act(async () => { control.value = value; control.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function checkAllGood() { for (const control of conditionControls()) await choose(control, "good"); }
async function confirm() {
  const button = host.querySelector<HTMLButtonElement>('button[type="submit"]'); expect(button).not.toBeNull();
  await act(async () => button!.click());
}
async function expectOutcome(label: string) {
  await waitForUi(() => { expect(host.textContent).toContain("Return saved"); expect(host.textContent).toContain("Equipment status: " + label); });
}
function assertRecords(status: string, count: number) {
  const { loan, records } = fixture.db.state;
  expect(loan.returned_at).toBeInstanceOf(Date);
  expect(loan.returned_at!.getTime()).toBeLessThanOrEqual(loan.due_date.getTime());
  expect(records).toHaveLength(count);
  for (const record of records) {
    expect(record[0]).toBe(loanId); expect(record[1]).toBe(itemId); expect(record[3]).toBe(7); expect(record[6]).toBe(actorId);
    expect((record[7] as Date).toISOString()).toBe(loan.returned_at!.toISOString());
  }
  expect(new Set(records.map(row => row[2])).size).toBe(count);
  const inserts = fixture.db.sql.filter(q => q.text.includes("insert into public.condition_records"));
  expect(inserts).toHaveLength(count); expect(inserts.every(q => q.text.includes("'return'"))).toBe(true);
  expect(loan.return_operation).toMatchObject({ state: "completed", result: { loanId, returnedAt: loan.returned_at!.toISOString(), status, isLate: false } });
  expect(fixture.status).toBe(status);
  expect(fixture.history).toHaveLength(1);
  expect(fixture.history[0]).toMatchObject({ old_status: "checked_out", new_status: status, changed_by: actorId, request_key: expect.stringMatching(/:0:apply$/) });
  expect(fixture.history[0].changed_at.getTime()).toBeGreaterThanOrEqual(loan.returned_at!.getTime());
}

it("TC-4.1: checks all five components, persists an on-time return/history and displays Available", async () => {
  await openReturn();
  expect(conditionControls()).toHaveLength(6); // main item plus all FIVE components
  for (const component of components) { expect(host.textContent).toContain(component.component_name); expect(host.textContent).toContain("Checked at handover: " + component.component_name); }
  expect(host.textContent).toContain("Condition at pickup");
  await checkAllGood(); await confirm(); await expectOutcome("Available");
  assertRecords("available", 6);
  expect(fixture.db.state.records.map(row => row[2])).toEqual([null, ...components.map(c => c.id)]);
  expect(fixture.db.state.records.every(row => row[4] === "good" && row[5] === null)).toBe(true);
  expect(host.textContent).toContain("Recorded as on time.");
  const viewHistory = [...host.querySelectorAll("button")].find(button => button.textContent === "View return history");
  expect(viewHistory).toBeDefined();
  await act(async () => viewHistory!.click());
  await waitForUi(() => expect(host.textContent).toContain("Already returned"));
  expect(host.querySelector('[aria-labelledby="return-history-heading"]')).not.toBeNull();
  expect(host.querySelector("form")).toBeNull(); expect(fixture.posts).toHaveLength(1); expect(fixture.history).toHaveLength(1);
});

it("S2-10 active new pickup period: persists Reserved and displays Reserved instead of Available", async () => {
  fixture.db.settings.activePickup = true;
  await openReturn(); await checkAllGood(); await confirm(); await expectOutcome("Reserved");
  assertRecords("reserved", 6); expect(fixture.history.some(row => row.new_status === "available")).toBe(false);
  const window = fixture.db.sql.find(q => q.text.includes("select exists"));
  expect(window?.text).toContain("status = 'confirmed'"); expect(window?.text).toContain("start_at <= $3"); expect(window?.text).toContain("end_at > $3"); expect(window?.text).toContain("id is distinct from $4");
});

it("TC-4.2: persists the missing charger, never makes it Available, and shows student catalogue status", async () => {
  await openReturn(); await checkAllGood();
  await choose(conditionControls()[1], "missing"); // named Charger, not an arbitrary component
  expect(host.querySelector('label[for="condition-' + components[0].id + '"]')?.textContent).toBe("Charger");
  await confirm(); await expectOutcome("Inspection Required"); assertRecords("inspection_required", 6);
  expect(fixture.db.state.records.find(row => row[2] === components[0].id)?.[4]).toBe("missing");
  expect(fixture.db.state.records.filter(row => row[2] !== components[0].id).every(row => row[4] === "good")).toBe(true);
  expect(fixture.history.some(row => row.new_status === "available")).toBe(false);
  fixture.asStudent(); await act(async () => root.render(<CatalogueClient />));
  await waitForUi(() => expect(host.querySelector("li")?.textContent).toContain(fixture.name));
  expect(host.querySelector("li")?.textContent).toContain("Inspection Required");
  expect(host.textContent).not.toContain("Fixture borrower"); expect(host.textContent).not.toContain("Charger"); // generic status, NOT a private problem-detail view
  expect(fixture.requests.some(r => r.path === "equipment/items" && r.identity?.role === "student")).toBe(true);
});

it("TC-4.3: compares Good pickup with a broken casing, persists new damage and displays Inspection Required", async () => {
  fixture.name = "Sensor"; fixture.components = []; fixture.db.state.pickup.splice(1);
  fixture.db.state.pickup[0].notes = "Casing intact at handover";
  await openReturn(); expect(host.textContent).toContain("Good"); expect(host.textContent).toContain("Casing intact at handover");
  await choose(conditionControls()[0], "damaged");
  const damage = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => damage.click());
  const notes = host.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(notes, "Broken casing"); notes.dispatchEvent(new Event("input", { bubbles: true })); });
  await confirm(); await expectOutcome("Inspection Required"); assertRecords("inspection_required", 1);
  expect(fixture.db.state.pickup[0].condition_status).toBe("good");
  expect(fixture.db.state.records[0][4]).toBe("damaged");
  expect(fixture.db.state.records[0][5]).toBe("New or additional damage reported at return.\nBroken casing");
  expect(fixture.history.some(row => row.new_status === "available")).toBe(false);
});

it("requires every component choice before the actual confirm button can submit", async () => {
  await openReturn(); const choices = conditionControls();
  for (const choice of choices.slice(0, -1)) await choose(choice, "good");
  expect(choices.at(-1)!.validity.valueMissing).toBe(true); expect(host.querySelector("form")!.checkValidity()).toBe(false);
  await confirm(); expect(fixture.posts).toHaveLength(0); expect(fixture.db.state.records).toHaveLength(0); expect(fixture.history).toHaveLength(0);
});

it("disables duplicate confirmation while pending and preserves replay without duplicate history", async () => {
  fixture.confirmationGate = new Promise(resolve => { releaseConfirmation = resolve; });
  await openReturn(); await checkAllGood(); await confirm();
  await waitForUi(() => expect(fixture.posts).toHaveLength(1));
  expect(host.querySelector("fieldset")!.disabled).toBe(true); expect(host.textContent).toContain("Saving return...");
  await confirm(); expect(fixture.posts).toHaveLength(1);
  releaseConfirmation!(); await expectOutcome("Available"); assertRecords("available", 6);
  const replay = await fixture.confirmAgain(fixture.posts[0]); expect(replay.status).toBe(200);
  expect((await replay.json()).returnedAt).toBe(fixture.db.state.loan.returned_at!.toISOString());
  expect(fixture.db.state.records).toHaveLength(6); expect(fixture.history).toHaveLength(1);
});

it("blocks the form on a lost Equipment response, then safely recovers the same operation", async () => {
  fixture.loseApplyResponse = true;
  await openReturn(); await checkAllGood(); await confirm();
  await waitForUi(() => expect(host.textContent).toContain("The return result needs verification."));
  expect(host.querySelector("form")).toBeNull(); expect(fixture.posts).toHaveLength(1);
  expect(fixture.db.state.records).toHaveLength(0); expect(fixture.db.state.loan.return_operation).toMatchObject({ state: "planned" });
  expect(fixture.history).toHaveLength(1); expect(fixture.status).toBe("available");
  const result = await fixture.confirmAgain(fixture.posts[0]); expect(result.status).toBe(200);
  expect(fixture.db.state.records).toHaveLength(6); expect(fixture.history).toHaveLength(1);
});

it("does not classify unchanged existing damage as new damage", async () => {
  fixture.db.state.pickup[0].condition_status = "damaged";
  await openReturn(); await checkAllGood(); await choose(conditionControls()[0], "damaged");
  expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
  await confirm(); await expectOutcome("Available"); assertRecords("available", 6);
  expect(fixture.db.state.records.find(row => row[2] === null)?.[5]).toBeNull();
});
