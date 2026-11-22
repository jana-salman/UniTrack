"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { Icon } from "./icon";
import type { WorkspaceLink } from "./workspace-links";

export function WorkspaceMenu({ links, labId }: { links: WorkspaceLink[]; labId: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const scanWorkflow = pathname.startsWith("/handover/") || pathname.startsWith("/return/");

  return (
    <div className="workspace-menu" onKeyDown={(event) => {
      if (event.key === "Escape" && open) {
        setOpen(false);
        toggle.current?.focus();
      }
    }}>
      <button
        type="button"
        ref={toggle}
        className="menu-toggle"
        aria-expanded={open}
        aria-controls="workspace-menu-panel"
        onClick={() => setOpen(!open)}
      >
        <Icon name={open ? "close" : "menu"} /> Menu
      </button>
      <div id="workspace-menu-panel" className="workspace-menu-panel" data-open={open}>
        <nav aria-label="Primary navigation">
          <ul>
            {links.map(({ href, icon, label }) => {
              const current = pathname === href;
              const related = scanWorkflow && href === "/scan";
              return (
                <li key={href}>
                  <Link href={href} aria-current={current ? "page" : related ? "location" : undefined} onClick={() => setOpen(false)}>
                    <Icon name={icon} /> {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <p className="workspace-lab"><Icon name="lab" /> Laboratory {labId}</p>
      </div>
    </div>
  );
}
