import { Suspense } from "react";
import { requirePageProfile } from "@/lib/auth/authorization";
import CatalogueClient from "@/components/CatalogueClient";
import { PageHeading } from "@/components/page-heading";
import { PageStatus } from "@/components/page-status";

export const instant = false;

async function CatalogueContent() {
  const profile = await requirePageProfile();

  return (
    <>
      <PageHeading title="Equipment catalogue" section="Catalogue" context={`Laboratory ${profile.lab_id}`} />
      <CatalogueClient />
    </>
  );
}

export default function CataloguePage() {
  return (
    <Suspense fallback={<PageStatus>Loading the catalogue…</PageStatus>}>
      <CatalogueContent />
    </Suspense>
  );
}
