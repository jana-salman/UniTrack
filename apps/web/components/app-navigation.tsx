import { logout } from "@/app/actions";
import { roleLabel, type Profile } from "@/lib/auth/model";
import { Brand } from "./brand";
import { WorkspaceMenu } from "./workspace-menu";
import { workspaceLinks } from "./workspace-links";

export function AppNavigation({ profile }: { profile: Profile }) {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="institutional-header workspace-header">
        <div className="workspace-header-start">
          <WorkspaceMenu links={workspaceLinks(profile.role)} labId={profile.lab_id} />
          <Brand href="/dashboard" />
        </div>
        <div className="workspace-account">
          <div className="account-identity">
            <strong>{profile.full_name}</strong>
            <span>{roleLabel(profile.role)}</span>
          </div>
          <form action={logout}>
            <button className="sign-out" type="submit">Sign out</button>
          </form>
        </div>
      </header>
    </>
  );
}
