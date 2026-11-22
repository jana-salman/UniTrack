// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const itemId = "11111111-1111-4111-8111-111111111111";
const reservationId = "22222222-2222-4222-8222-222222222222";
const loanId = "44444444-4444-4444-8444-444444444444";

vi.mock("@/components/equipment/equipment-qr-scanner", () => ({
  default: ({ onScan }: { onScan: (value: string) => void }) => (
    <button type="button" onClick={() => onScan(itemId)}>
      Scan fixture
    </button>
  ),
}));

import ScanResult from "@/app/(protected)/scan/scan-result";

type MatchOverrides = {
  equipmentId?: string;
  equipmentStatus?: string;
  eligibility?: "upcoming" | "eligible" | "expired";
  canHandover?: boolean;
};

function match({
  equipmentId = itemId,
  equipmentStatus = "reserved",
  eligibility = "eligible",
  canHandover = true,
}: MatchOverrides = {}) {
  return {
    equipment: {
      id: equipmentId,
      name: "Fixture camera",
      status: equipmentStatus,
    },
    activeLoan: null,
    confirmedReservations: [
      {
        id: reservationId,
        startAt: "2026-11-22T09:00:00.000Z",
        endAt: "2026-11-22T11:00:00.000Z",
        eligibility,
      },
    ],
    multipleEligibleReservations: false,
    canHandover,
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function scanWith(payload: ReturnType<typeof match>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json(payload)),
  );

  await act(async () => root.render(<ScanResult canViewReservations />));
  const scanButton = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Scan fixture",
  );
  expect(scanButton).toBeDefined();

  await act(async () => {
    scanButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  await vi.waitFor(() => {
    expect(host.textContent).toContain("Confirmed Reservations");
  });
}

describe("scan-to-handover navigation", () => {
  it("uses the looked-up equipment ID and links to its active loan", async () => {
    const fetchMatch = vi.fn().mockResolvedValue(Response.json({
      ...match({ canHandover: false }),
      activeLoan: { id: loanId, dueDate: "2026-11-22T11:00:00.000Z" },
      confirmedReservations: [],
    }));
    vi.stubGlobal("fetch", fetchMatch);

    await act(async () => root.render(<ScanResult canViewReservations initialItemId={itemId} />));
    expect(fetchMatch).toHaveBeenCalledWith(`/api/reservations/pickup?itemId=${itemId}`, expect.any(Object));
    expect(host.querySelector('a[href^="/return/"]')?.getAttribute("href")).toBe(`/return/${loanId}`);
  });

  it("ignores a preselected item when reservation visibility is unavailable", async () => {
    const fetchMatch = vi.fn();
    vi.stubGlobal("fetch", fetchMatch);
    await act(async () => root.render(<ScanResult canViewReservations={false} initialItemId={itemId} />));
    expect(fetchMatch).not.toHaveBeenCalled();
    expect(host.querySelector("a")).toBeNull();
  });

  it("links only interrupted handovers for the selected equipment", async () => {
    const otherItem = "55555555-5555-4555-8555-555555555555";
    const otherReservation = "66666666-6666-4666-8666-666666666666";
    const pending = { startedAt: "2026-11-22T09:00:00.000Z", state: "applied", recoverableByYou: true };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(
      url === "/api/handover" ? [
        { ...pending, itemId, reservationId },
        { ...pending, itemId: otherItem, reservationId: otherReservation },
      ] : { ...match({ canHandover: false, equipmentStatus: "checked_out" }), confirmedReservations: [] },
    )));

    await act(async () => root.render(<ScanResult canViewReservations initialItemId={itemId} />));
    await vi.waitFor(() => {
      const links = [...host.querySelectorAll('a[href^="/handover/"]')].map((link) => link.getAttribute("href"));
      expect(links).toEqual([`/handover/${reservationId}`]);
    });
  });

  it.each(["available", "reserved"])(
    "links eligible %s equipment to the confirmed reservation's handover route",
    async (equipmentStatus) => {
      await scanWith(match({ equipmentStatus }));

      const link = [...host.querySelectorAll("a")].find(
        (anchor) => anchor.textContent === "Proceed to Handover",
      );

      expect(link?.getAttribute("href")).toBe(`/handover/${reservationId}`);
      expect(host.textContent).not.toContain(
        "Handover is temporarily disabled pending integration.",
      );
    },
  );

  it.each([
    ["an upcoming pickup window", { eligibility: "upcoming" }],
    ["an expired pickup window", { eligibility: "expired" }],
    [
      "a different scanned item",
      { equipmentId: "33333333-3333-4333-8333-333333333333" },
    ],
    ["an ineligible equipment status", { equipmentStatus: "checked_out" }],
    ["a rejected service-side match", { canHandover: false }],
  ] as const)("keeps handover unavailable for %s", async (_name, overrides) => {
    await scanWith(match(overrides));

    expect(
      [...host.querySelectorAll("a")].some(
        (anchor) => anchor.textContent === "Proceed to Handover",
      ),
    ).toBe(false);
    const unavailable = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Handover unavailable",
    );
    expect(unavailable?.disabled).toBe(true);
  });
});
