import Link from "next/link";
import { Suspense } from "react";
import { requirePageProfile } from "@/lib/auth/authorization";
import { Icon } from "@/components/icon";
import { PageHeading } from "@/components/page-heading";
import { PageStatus } from "@/components/page-status";
import { workspaceLinks } from "@/components/workspace-links";
import ReturnProblems from "./return-problems";

export const instant = false;

async function DashboardContent() {
  const profile = await requirePageProfile();
  const links = workspaceLinks(profile.role).filter((link) => link.href !== "/dashboard");

  return (
    <>
      <PageHeading title={`Welcome, ${profile.full_name}`} section="Dashboard" context={`Laboratory ${profile.lab_id}`} />
      <ul className="dashboard-links" aria-label="Workspace tasks">
        {links.map(({ href, icon, label, description }) => (
          <li key={href}>
            <Link className="panel dashboard-link" href={href}>
              <Icon name={icon} />
              <div><strong>{label}</strong><span>{description}</span></div>
              <Icon name="arrow" />
            </Link>
          </li>
        ))}
      </ul>
      {profile.role === "student" && <ReturnProblems key={`${profile.id}:${profile.lab_id}`} />}
    </>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<PageStatus>Loading your workspace…</PageStatus>}>
      <DashboardContent />
    </Suspense>
  );
}
