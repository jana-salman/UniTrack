import { PageHeading } from "@/components/page-heading";
import { requirePageProfile } from "@/lib/auth/authorization";
import { listProfilesByLab } from "@/lib/profiles";
import { RoleEditor } from "./role-editor";

export const instant = false;

export default async function ManageUsersPage() {
  const manager = await requirePageProfile(["lab_manager"]);
  const profiles = await listProfilesByLab(manager);

  return (
    <>
      <PageHeading title="Manage user roles" section="Manage roles" description="Review accounts and manage roles in your laboratory." context={`Laboratory ${manager.lab_id}`} />

      <div className="panel overflow-x-auto" role="region" aria-label="User roles" tabIndex={0}>
        <table className="w-full border-collapse text-left">
          <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
            <tr>
              <th className="px-5 py-4" scope="col">User</th>
              <th className="px-5 py-4" scope="col">Status</th>
              <th className="px-5 py-4" scope="col">Role</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile) => (
              <tr className="border-t border-slate-200" key={profile.id}>
                <td className="px-5 py-4">
                  <strong className="block text-slate-950">{profile.full_name}</strong>
                  <span className="mt-1 block text-sm text-slate-500">{profile.university_email}</span>
                </td>
                <td className="px-5 py-4">
                  <span
                    className={
                      `inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                        profile.is_active
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-red-50 text-red-700"
                      }`
                    }
                  >
                    {profile.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="min-w-72 px-5 py-4">
                  <RoleEditor profile={profile} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
