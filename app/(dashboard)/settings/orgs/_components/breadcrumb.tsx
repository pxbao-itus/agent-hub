import Link from "next/link";

type Segment = { label: string; href?: string };

export function Breadcrumb({ segments }: { segments: Segment[] }) {
  return (
    <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
      {segments.map((seg, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span>/</span>}
          {seg.href ? (
            <Link href={seg.href} className="hover:text-foreground transition-colors">
              {seg.label}
            </Link>
          ) : (
            <span className="text-foreground font-medium">{seg.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
