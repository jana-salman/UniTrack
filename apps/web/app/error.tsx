"use client";

import { PublicPage } from "@/components/public-page";

export default function PageError({ retry }: { retry: () => void }) {
  return (
    <PublicPage>
      <h1>Unable to load this page</h1>
      <p className="page-description">Try again in a moment.</p>
      <button className="action-primary mt-6" type="button" onClick={retry}>Try again</button>
    </PublicPage>
  );
}
