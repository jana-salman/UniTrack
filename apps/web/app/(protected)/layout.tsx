import { connection } from "next/server";
import { AppNavigation } from "@/components/app-navigation";
import { SiteFooter } from "@/components/brand";
import { requirePageProfile } from "@/lib/auth/authorization";

export const instant = false;

export default async function ProtectedLayout({ children }: LayoutProps<"/">) {
  await connection();
  const profile = await requirePageProfile();

  return (
    <div className="workspace-shell">
      <AppNavigation profile={profile} />
      <div className="workspace-content">
        <main id="main-content" tabIndex={-1}>{children}</main>
        <SiteFooter />
      </div>
    </div>
  );
}
