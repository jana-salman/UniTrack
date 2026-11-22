import Link from "next/link";
import { requirePageProfile } from "@/lib/auth/authorization";
import { isValidEquipmentQrPayload } from "@/lib/qr/qr-payload";
import { PageHeading } from "@/components/page-heading";
import ScanResult from "./scan-result";

export const instant = false;

export default async function ScanPage({ searchParams }: PageProps<"/scan">) {
  const profile = await requirePageProfile(["lab_manager", "lab_assistant", "professor"]);
  const canViewReservations = profile.role === "lab_assistant";
  const { itemId } = await searchParams;
  const initialItemId = canViewReservations && typeof itemId === "string" && isValidEquipmentQrPayload(itemId)
    ? itemId.trim()
    : undefined;

  return (
    <>
      <PageHeading
        title="Scan equipment"
        section="Scan"
        description={canViewReservations ? "Find an eligible pickup or active loan using the equipment’s QR code or UUID." : undefined}
      />
      <ScanResult key={initialItemId} canViewReservations={canViewReservations} initialItemId={initialItemId} />
      <Link href="/equipment/lookup" className="action-secondary mt-5">Find equipment by asset code</Link>
    </>
  );
}
