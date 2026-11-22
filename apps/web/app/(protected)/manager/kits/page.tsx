import { requirePageProfile } from "@/lib/auth/authorization";
import KitManagementClient from "@/components/KitManagementClient";

export const instant = false;

export default async function ManageKitsPage() {
  await requirePageProfile(["lab_manager"]);
  return <KitManagementClient />;
}
