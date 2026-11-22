import Link from "next/link";
import { logout } from "@/app/actions";
import { PublicPage } from "@/components/public-page";

export default function UnauthorizedPage() {
  return (
    <PublicPage>
      <h1>Access denied</h1>
      <p className="page-description">Your account does not have access to this page.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link className="action-secondary" href="/dashboard">Back to dashboard</Link>
        <form action={logout}>
          <button className="action-primary" type="submit">Sign in with another account</button>
        </form>
      </div>
    </PublicPage>
  );
}
