// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const itemId = "11111111-1111-4111-8111-111111111111";
const reservationId = "22222222-2222-4222-8222-222222222222";

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
