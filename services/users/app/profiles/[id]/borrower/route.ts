import { isProfileId, type BorrowerVerification } from "@unitrack/contracts";
import { requireUser } from "../../../../lib/authorization";
import { findProfileById } from "../../../../lib/profiles";
import { usersFailure } from "../../../../lib/errors";

// S2-09 handover: lets same-lab staff (and Loans acting for a verified lab
// assistant) confirm a reservation's borrower is a real, active profile in
// their laboratory. Minimal projection: no email or other profile fields.
// Users reports facts (role, lab, active); Loans decides eligibility.
export async function GET(request: Request, context: RouteContext<"/profiles/[id]/borrower">) {
  try {
    const actor = await requireUser(request, ["lab_assistant", "lab_manager"]);
    const { id } = await context.params;
    if (!isProfileId(id)) return Response.json({ error: "Invalid user id." }, { status: 400 });
    const profile = await findProfileById(id);
    // Other laboratories are indistinguishable from missing profiles.
    if (!profile || profile.lab_id !== actor.lab_id) return Response.json({ error: "User profile not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    const body: BorrowerVerification = { id: profile.id, full_name: profile.full_name, role: profile.role, lab_id: profile.lab_id, is_active: profile.is_active };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return usersFailure(error); }
}
