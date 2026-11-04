import Link from "next/link";

import { logout } from "@/app/actions";
import { MobileMenu, type NavLink } from "@/components/mobile-menu";
import { roleLabel, type Profile } from "@/lib/auth/model";

export function AppNavigation({ profile }: { profile: Profile }) {
  const canScan = profile.role !== "student";
  const isManager = profile.role === "lab_manager";

  const navigation: NavLink[] = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/catalogue", label: "Catalogue" },
    ...(canScan ? [{ href: "/scan", label: "Scan" }] : []),
    ...(isManager
      ? [
          { href: "/manager/equipment", label: "Equipment" },
          { href: "/manager/categories", label: "Categories" },
          { href: "/manager/users", label: "Manage roles" },
        ]
      : []),
  ];

  return (
    <header className="relative flex min-h-20 items-center gap-x-8 border-b border-slate-200 bg-white px-4 py-3 sm:px-8">
      <Link className="flex items-center gap-2.5 text-lg font-extrabold text-slate-950" href="/dashboard">
        <span className="grid size-8 place-items-center rounded-lg bg-blue-700 text-sm text-white">U</span>
        UniTrack
      </Link>

      <nav aria-label="Primary navigation" className="hidden gap-1 md:flex md:flex-1">
        {navigation.map((item) => (
          <Link className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-blue-50 hover:text-blue-700" href={item.href} key={item.href}>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-3 text-right">
        <div className="hidden md:grid">
          <strong className="text-sm text-slate-900">{profile.full_name}</strong>
          <span className="text-xs text-slate-500">{roleLabel(profile.role)}</span>
        </div>
        <MobileMenu links={navigation} />
        <form action={logout}>
          <button className="rounded-lg px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}