import { PageHeading } from "@/components/page-heading";
import { requirePageProfile } from "@/lib/auth/authorization";
import HandoverDetails from "./handover-details";

export const instant = false;

export default async function HandoverPage({
  params,
}: {
  params: Promise<{ reservationId: string }>;
}) {
  // Server-side page guard; the API gateway and Loans enforce it again.
  await requirePageProfile(["lab_assistant"]);

  const { reservationId } = await params;

  return (
    <>
      <PageHeading title="Hand over equipment" section="Handover" description="Check each item, record its condition, and ask the student to confirm." parent={{ href: "/scan", label: "Scan" }} />

      <HandoverDetails key={reservationId} reservationId={reservationId} />
    </>
  );
}
