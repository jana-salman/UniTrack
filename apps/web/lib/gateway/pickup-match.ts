import "server-only";

import {
  EQUIPMENT_ERROR_CONTRACT,
  isEquipmentItemSnapshot,
  isProfileId,
} from "@unitrack/contracts";
import { AuthorizationError } from "@/lib/auth/errors";
import { trustedIdentity, callLoans } from "./loans";
import { createServiceCaller } from "./call-service";

type PickupEligibility =
  | "upcoming"
  | "eligible"
  | "expired";

type PickupMatchResponse = {
  activeLoan: {
    id: string;
    dueDate: string;
  } | null;
  confirmedReservations: {
    id: string;
    startAt: string;
    endAt: string;
    eligibility: PickupEligibility;
  }[];
  multipleEligibleReservations: boolean;
  canHandover: boolean;
};

function isPickupMatchResponse(
  value: unknown,
): value is PickupMatchResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const data = value as Record<string, unknown>;
  const loan = data.activeLoan;

  const validLoan =
    loan === null ||
    (
      typeof loan === "object" &&
      loan !== null &&
      !Array.isArray(loan) &&
      isProfileId((loan as Record<string, unknown>).id) &&
      typeof (loan as Record<string, unknown>).dueDate === "string" &&
      !Number.isNaN(
        Date.parse((loan as Record<string, string>).dueDate),
      )
    );

  const validReservations =
    Array.isArray(data.confirmedReservations) &&
    data.confirmedReservations.length <= 100 &&
    data.confirmedReservations.every((entry: unknown) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return false;
      }

      const reservation = entry as Record<string, unknown>;

      return (
        isProfileId(reservation.id) &&
        typeof reservation.startAt === "string" &&
        typeof reservation.endAt === "string" &&
        !Number.isNaN(Date.parse(reservation.startAt)) &&
        !Number.isNaN(Date.parse(reservation.endAt)) &&
        Date.parse(reservation.endAt) >
          Date.parse(reservation.startAt) &&
        (
          reservation.eligibility === "upcoming" ||
          reservation.eligibility === "eligible" ||
          reservation.eligibility === "expired"
        )
      );
    });

  if (
    !validLoan ||
    !validReservations ||
    typeof data.multipleEligibleReservations !== "boolean" ||
    typeof data.canHandover !== "boolean"
  ) {
    return false;
  }

  const reservations =
    data.confirmedReservations as PickupMatchResponse["confirmedReservations"];

  const eligibleCount = reservations.filter(
    (reservation) => reservation.eligibility === "eligible",
  ).length;

  // Reject inconsistent eligibility information.
  if (data.multipleEligibleReservations !== (eligibleCount > 1)) {
    return false;
  }

  if (data.canHandover !== (loan === null && eligibleCount === 1)) {
    return false;
  }

  return true;
}

function failure(
  status: number,
  error: string,
  code: string,
  requestId?: string,
): Response {
  return Response.json(
    { error, code },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        ...(requestId ? { "X-Request-Id": requestId } : {}),
      },
    },
  );
}

export async function forwardPickupMatch(
  request: Request,
): Promise<Response> {
  try {
    const identity = await trustedIdentity(request);

    if (identity.role !== "lab_assistant") {
      return failure(
        403,
        "Permission denied.",
        "forbidden",
        identity.rid,
      );
    }

    const itemId = new URL(request.url).searchParams.get("itemId");

    if (!itemId || !isProfileId(itemId)) {
      return failure(
        400,
        "A valid equipment item ID is required.",
        "invalid_item",
        identity.rid,
      );
    }

    const callEquipment = createServiceCaller({
      baseUrl: process.env.EQUIPMENT_SERVICE_URL ?? "",
      secret: process.env.INTERNAL_JWT_SECRET ?? "",
      errorContract: EQUIPMENT_ERROR_CONTRACT,
    });

    // Verify the equipment exists in the requesting user's lab.
    const equipmentResponse = await callEquipment(
      "/items/" + encodeURIComponent(itemId),
      identity,
    );

    if (!equipmentResponse.ok) {
      return failure(
        equipmentResponse.status,
        "Equipment lookup failed.",
        "equipment_lookup_failed",
        identity.rid,
      );
    }

    const equipmentPayload: unknown = await equipmentResponse.json();

    if (
      !isEquipmentItemSnapshot(equipmentPayload) ||
      equipmentPayload.id.toLowerCase() !== itemId.toLowerCase() ||
      equipmentPayload.lab_id !== identity.lab_id
    ) {
      return failure(
        502,
        "Invalid equipment service response.",
        "service_response",
        identity.rid,
      );
    }

    // Ask Loans for reservations, eligibility and active loans.
    const loansResponse = await callLoans(
      "/reservations/pickup?itemId=" +
        encodeURIComponent(itemId),
      identity,
    );

    if (!loansResponse.ok) {
      return failure(
        loansResponse.status,
        "Reservation lookup failed.",
        "reservation_lookup_failed",
        identity.rid,
      );
    }

    const matchPayload: unknown = await loansResponse.json();

    if (!isPickupMatchResponse(matchPayload)) {
      return failure(
        502,
        "Invalid Loans Service response.",
        "service_response",
        identity.rid,
      );
    }

    // Handover is permitted only for available or reserved equipment.
    const hasEligibleEquipmentStatus =
      equipmentPayload.status === "available" ||
      equipmentPayload.status === "reserved";

    return Response.json(
      {
        equipment: {
          id: equipmentPayload.id,
          name: equipmentPayload.name,
          status: equipmentPayload.status,
        },
        activeLoan: matchPayload.activeLoan
          ? {
              id: matchPayload.activeLoan.id,
              dueDate: matchPayload.activeLoan.dueDate,
            }
          : null,
        confirmedReservations:
          matchPayload.confirmedReservations.map((reservation) => ({
            id: reservation.id,
            startAt: reservation.startAt,
            endAt: reservation.endAt,
            eligibility: reservation.eligibility,
          })),
        multipleEligibleReservations:
          matchPayload.multipleEligibleReservations,
        canHandover:
          matchPayload.canHandover && hasEligibleEquipmentStatus,
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Request-Id": identity.rid,
        },
      },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return failure(
        error.status,
        error.message,
        error.code,
      );
    }

    return failure(
      503,
      "Equipment or Loans Service is unavailable.",
      "pickup_unavailable",
    );
  }
}