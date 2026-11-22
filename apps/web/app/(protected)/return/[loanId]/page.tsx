import { PageHeading } from "@/components/page-heading";
import { requirePageProfile } from "@/lib/auth/authorization";
import ReturnDetails from "./return-details";

export const instant = false;

export default async function ReturnPage({
  params,
}: {
  params: Promise<{ loanId: string }>;
}) {
  await requirePageProfile(["lab_assistant"]);

  const { loanId } = await params;

  return (
    <>
      <PageHeading title="Return equipment" section="Return" description="Compare the returned equipment with its pickup record." parent={{ href: "/scan", label: "Scan" }} />

      <ReturnDetails key={loanId} loanId={loanId} />
    </>
  );
}