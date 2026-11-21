import { requirePageProfile } from "@/lib/auth/authorization";
import KitManagementClient from "@/components/KitManagementClient";

export default async function ManageKitsPage() {
  await requirePageProfile(["lab_manager"]);
  return <KitManagementClient />;
}
