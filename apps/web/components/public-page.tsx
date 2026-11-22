import type { ReactNode } from "react";
import { Brand, SiteFooter } from "./brand";

export function PublicPage({ children }: { children: ReactNode }) {
  return (
    <div className="public-shell">
      <header className="institutional-header"><Brand /></header>
      <main className="public-content">
        <section className="public-panel">{children}</section>
      </main>
      <SiteFooter />
    </div>
  );
}
