import { requirePageProfile } from "@/lib/auth/authorization";
import { listProfilesByLab } from "@/lib/profiles";
import { RoleEditor } from "./role-editor";

export default async function ManageUsersPage() {
  const manager = await requirePageProfile(["lab_manager"]);
  const profiles = await listProfilesByLab(manager.lab_id);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <section className="mb-10 max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">
          Laboratory {manager.lab_id}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-5xl">
          Manage user roles
        </h1>
        <p className="mt-3 leading-7 text-slate-600">
          Role changes are restricted to active lab managers and users in the
          manager&apos;s own laboratory.
        </p>
      </section>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
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
    </main>
  );
}
