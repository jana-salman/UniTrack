"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type Role = "student" | "lab_assistant" | "professor" | "lab_manager";

type NavItem = { href: string; label: string; roles?: Role[] };

// If an item has no `roles`, every role sees it.
const items: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/equipment", label: "Equipment" },
  { href: "/requests", label: "Requests" },
  { href: "/manage", label: "Manage", roles: ["lab_assistant", "lab_manager"] },
];

export default function NavBar({ role = "student" }: { role?: Role }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const visible = items.filter((i) => !i.roles || i.roles.includes(role));

  return (
    <header className="border-b border-gray-200 bg-white text-gray-900">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-2">
        <Link href="/" className="text-lg font-bold">
          UniTrack
        </Link>

        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg border border-gray-300 px-3 md:hidden"
          aria-expanded={open}
          aria-controls="main-menu"
          aria-label="Toggle menu"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "✕" : "☰"}
        </button>

        <ul
          id="main-menu"
          className={`${
            open ? "flex" : "hidden"
          } absolute left-0 right-0 top-[57px] flex-col border-b border-gray-200 bg-white px-4 py-2 md:static md:flex md:flex-row md:gap-2 md:border-0 md:p-0`}
        >
          {visible.map((item) => {
            const active = pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center rounded-lg px-3 ${
                    active
                      ? "bg-blue-50 font-semibold text-blue-700"
                      : "hover:bg-gray-100"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}