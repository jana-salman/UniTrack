import { requirePageProfile } from "@/lib/auth/authorization";
import EquipmentCreationClient from "@/components/equipment-creation-client";

export default async function ManageEquipmentPage() {
  await requirePageProfile(["lab_manager"]);

  return <EquipmentCreationClient />;
}