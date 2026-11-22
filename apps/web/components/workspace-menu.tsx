"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icon";
import type { WorkspaceLink } from "./workspace-links";

export function WorkspaceMenu({ links, labId }: { links: WorkspaceLink[]; labId: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const scanWorkflow = pathname.startsWith("/handover/") || pathname.startsWith("/return/");

  const dismiss = useCallback(() => {
    setOpen(false);
    toggle.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    function handleOutsidePointer(event: PointerEvent) {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) {
        dismiss();
      }
    }

    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer);
  }, [open, dismiss]);

  return (
    <div
      ref={menu}
      className="workspace-menu"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          dismiss();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        ref={toggle}
        className="menu-toggle"
        aria-expanded={open}
        aria-controls="workspace-menu-panel"
        onClick={() => {
          if (open) dismiss();
          else {
            toggle.current?.focus();
            setOpen(true);
          }
        }}
      >
        <Icon name="menu" /> Menu
      </button>
      <div id="workspace-menu-panel" className="workspace-menu-panel" hidden={!open}>
        <nav aria-label="Primary navigation">
          <ul>
            {links.map(({ href, icon, label }) => {
              const current = pathname === href;
              const related = scanWorkflow && href === "/scan";
              return (
                <li key={href}>
                  <Link href={href} aria-current={current ? "page" : related ? "location" : undefined} onClick={dismiss}>
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
