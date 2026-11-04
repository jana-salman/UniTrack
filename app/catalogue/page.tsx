import { Suspense } from "react";
import { requirePageProfile } from "@/lib/auth/authorization";
import CatalogueClient from "@/components/CatalogueClient";

// Server page: only signed-in users reach the catalogue.
// requirePageProfile() sends visitors to /login (not signed in)
// or /unauthorized (wrong role or inactive account).
// Suspense is needed because the check reads cookies (Cache Components).
async function ProtectedCatalogue() {
  await requirePageProfile();
  return <CatalogueClient />;
}

export default function CataloguePage() {
  return (
    <Suspense fallback={<p style={{ padding: 16 }}>Loading…</p>}>
      <ProtectedCatalogue />
    </Suspense>
  );
}