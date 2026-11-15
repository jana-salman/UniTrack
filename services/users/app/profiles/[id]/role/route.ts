import { requireUser } from "../../../../lib/authorization";
import { handleRoleUpdate } from "../../../../lib/auth/role-update-handler";
import { updateProfileRoleInLab } from "../../../../lib/profiles";
export async function PATCH(request: Request, context: RouteContext<"/profiles/[id]/role">) {
 const { id } = await context.params;
 return handleRoleUpdate(request, id, { authorizeManager: () => requireUser(request, ["lab_manager"]), updateRoleInLab: updateProfileRoleInLab });
}
