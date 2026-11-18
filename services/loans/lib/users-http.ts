import "server-only";
import { signInternalToken } from "@unitrack/internal-auth";
import { isBorrowerVerification, isEligibleBorrower, type UserIdentity } from "@unitrack/contracts";
import { LoansConfigurationError, LoansError } from "./errors";

export const USERS_TIMEOUT_MS = 3000;

export interface VerifiedBorrower { id: string; fullName: string; role: "student"; labId: number }
/** labId is the AUTHORITATIVE reservation's lab; borrowerId its borrower_id. */
export interface BorrowerPort { verifyBorrower(borrowerId: string, labId: number): Promise<VerifiedBorrower> }

export const borrowerUnverified = () => new LoansError(409, "borrower_unverified", "The borrower's university profile could not be verified, so handover is not allowed.");
export const borrowerIneligible = () => new LoansError(409, "borrower_unverified", "The borrower must be an active student in this lab, matching the reservation.");
export const borrowerUnavailable = () => new LoansError(503, "borrower_unavailable", "The borrower's identity cannot be checked right now. Try again shortly.");

/**
 * Verifies a reservation's borrower through the Users service (Loans never
 * reads profiles). Signed as the VERIFIED lab assistant; Users enforces staff
 * role and same-lab scope and reports role/lab/active. PO decision (JS): the
 * borrower must be an ACTIVE STUDENT of the reservation's lab whose id is the
 * reservation's borrower_id. Fails closed:
 *   404                                         -> borrower_unverified (409)
 *   inactive / not a student / other lab / id   -> borrower_unverified (409)
 *   timeout / 5xx / bad payload                 -> borrower_unavailable (503)
 */
export function usersHttp(identity: UserIdentity): BorrowerPort {
  return {
    async verifyBorrower(borrowerId, labId) {
      let base: URL;
      const secret = process.env.INTERNAL_JWT_SECRET;
      try {
        base = new URL(process.env.USERS_SERVICE_URL ?? "");
        if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.pathname !== "/" || base.search || base.hash || !secret?.trim()) throw 0;
      } catch { throw new LoansConfigurationError("users"); }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), USERS_TIMEOUT_MS);
      let data: unknown;
      try {
        const token = await signInternalToken(identity, secret!);
        const response = await fetch(new URL("/profiles/" + encodeURIComponent(borrowerId) + "/borrower", base), {
          method: "GET", redirect: "error", cache: "no-store", credentials: "omit", signal: controller.signal,
          headers: { Authorization: "Bearer " + token, "X-Request-Id": identity.rid },
        });
        if (response.status === 404) throw borrowerUnverified();
        if (response.status === 401 || response.status === 403) throw new LoansError(403, "forbidden", "Permission denied.");
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw borrowerUnavailable();
        data = await response.json();
      } catch (error) {
        if (error instanceof LoansError) throw error;
        throw borrowerUnavailable();
      } finally { clearTimeout(timer); controller.abort(); }
      if (!isBorrowerVerification(data)) throw borrowerUnavailable();
      if (!isEligibleBorrower(data, borrowerId, labId)) throw borrowerIneligible();
      return { id: data.id.toLowerCase(), fullName: data.full_name, role: "student", labId: data.lab_id };
    },
  };
}
