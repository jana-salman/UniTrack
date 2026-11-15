import { forwardUsers } from "@/lib/gateway/users";
export async function PATCH(request: Request, context: RouteContext<"/api/users/[id]/role">) {
 const { id } = await context.params;
 return forwardUsers(request, "/profiles/" + encodeURIComponent(id) + "/role");
}
