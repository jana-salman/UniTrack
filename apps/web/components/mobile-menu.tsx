"use client";

import Link from "next/link";
import { useState } from "react";

export type NavLink = { href: string; label: string };

export function MobileMenu({ links }: { links: NavLink[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label="Toggle menu"
        onClick={() => setOpen((o) => !o)}
        className="grid size-11 place-items-center rounded-lg border border-slate-200 text-slate-700"
      >
        {open ? "✕" : "☰"}
      </button>

      <nav
        id="mobile-menu"
        aria-label="Mobile navigation"
        className={`${
          open ? "flex" : "hidden"
        } absolute inset-x-0 top-full z-10 flex-col border-b border-slate-200 bg-white px-4 py-2 shadow-sm`}
      >
        {links.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-slate-700 hover:bg-blue-50 hover:text-blue-700"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}