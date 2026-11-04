import { requirePageProfile } from "@/lib/auth/authorization";
import EquipmentCreationClient from "@/components/equipment-creation-client";
import EquipmentListClient from "@/components/equipment-list-client";

export default async function ManageEquipmentPage() {
  await requirePageProfile(["lab_manager"]);

  return (
    <>
      <EquipmentCreationClient />
      <EquipmentListClient />
    </>
  );
}