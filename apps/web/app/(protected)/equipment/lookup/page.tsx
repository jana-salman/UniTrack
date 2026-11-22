import Link from "next/link";
import { requirePageProfile } from "@/lib/auth/authorization";
import { PageHeading } from "@/components/page-heading";
import EquipmentLookupClient from "@/components/equipment/equipment-lookup-client";

export const instant = false;

export default async function EquipmentLookupPage() {
  const profile = await requirePageProfile(["lab_manager", "lab_assistant", "professor"]);
  const canMatchPickup = profile.role === "lab_assistant";
  const canReplaceQrLabel = profile.role === "lab_manager" || canMatchPickup;

  return (
    <>
      <PageHeading title="Find equipment" />
      <div className="max-w-3xl">
        <EquipmentLookupClient canReplaceQrLabel={canReplaceQrLabel} canMatchPickup={canMatchPickup} />
        <Link href="/scan" className="action-secondary mt-5">Scan a QR code</Link>
      </div>
    </>
  );
}
