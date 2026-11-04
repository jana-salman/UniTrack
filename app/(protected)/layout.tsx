import { connection } from "next/server";
import { AppNavigation } from "@/components/app-navigation";
import { requirePageProfile } from "@/lib/auth/authorization";

export const instant = false;

export default async function ProtectedLayout({ children }: LayoutProps<"/">) {
  await connection();

  const profile = await requirePageProfile();

  return (
    <div className="min-h-screen bg-slate-50">
      <AppNavigation profile={profile} />
      {children}
    </div>
  );
}