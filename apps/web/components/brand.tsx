import Image from "next/image";
import Link from "next/link";

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand">
      <Image src="/aub-logo.png" alt="American University of Beirut" width={427} height={165} loading="eager" unoptimized />
      <span className="brand-wordmark">
        <strong>UniTrack</strong>
        <span>Equipment services</span>
      </span>
    </Link>
  );
}

export function SiteFooter() {
  return <footer className="site-footer">UniTrack · American University of Beirut</footer>;
}
