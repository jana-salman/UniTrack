import { requireRole } from "@/lib/auth/authorization";
import { handleRoleUpdate } from "@/lib/auth/role-update-handler";
import { updateProfileRoleInLab } from "@/lib/profiles";

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/users/[id]/role">,
) {
  const { id } = await context.params;
  return handleRoleUpdate(request, id, {
    authorizeManager: () => requireRole(["lab_manager"]),
    updateRoleInLab: updateProfileRoleInLab,
  });
}
