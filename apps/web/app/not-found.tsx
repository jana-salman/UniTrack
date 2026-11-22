import Link from "next/link";
import { PublicPage } from "@/components/public-page";

export default function NotFoundPage() {
  return (
    <PublicPage>
      <h1>Page unavailable</h1>
      <p className="page-description">Check the address or return to your dashboard.</p>
      <Link className="action-primary mt-6" href="/dashboard">Back to dashboard</Link>
    </PublicPage>
  );
}
