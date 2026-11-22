import type { ReactNode } from "react";
import Link from "next/link";

export function PageHeading({
  title,
  section,
  parent,
  description,
  context,
}: {
  title: string;
  section?: string;
  parent?: { href: string; label: string };
  description?: ReactNode;
  context?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <nav aria-label="Breadcrumb">
        <ol className="breadcrumbs">
          <li><Link href="/dashboard">UniTrack</Link></li>
          {parent && <li><Link href={parent.href}>{parent.label}</Link></li>}
          <li aria-current="page">{section ?? title}</li>
        </ol>
      </nav>
      <div className="page-heading-title">
        <h1>{title}</h1>
        {context && <span>{context}</span>}
      </div>
      {description && <p className="page-description">{description}</p>}
    </header>
  );
}
