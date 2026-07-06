"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { LayoutDashboard, BookText, Wrench, Package, ClipboardList, FileText, FolderKanban, GitBranch, Compass, Building2, Key, Sun, Moon, Users, Search, Upload, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const MAIN_NAV = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard, exact: true },
  { label: "Prompts", href: "/prompts", icon: BookText },
  { label: "Skills", href: "/skills", icon: Wrench },
  { label: "Kits", href: "/kits", icon: Package },
  { label: "Plans", href: "/plans", icon: ClipboardList },
  { label: "Docs", href: "/docs", icon: FileText },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Workflows", href: "/workflows", icon: GitBranch },
  { label: "Explore", href: "/explore", icon: Compass },
];

const SETTINGS_NAV = [
  { label: "Import", href: "/import", icon: Upload },
  { label: "Organizations", href: "/settings/orgs", icon: Building2 },
  { label: "MCP Tokens", href: "/settings/tokens", icon: Key },
];

export function SidebarNav({
  onNavigate,
  isSuperAdmin,
}: {
  onNavigate?: () => void;
  isSuperAdmin?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;
    onNavigate?.();
    router.push(`/search?q=${encodeURIComponent(query)}`);
  }

  function NavItem({ label, href, icon: Icon, exact }: { label: string; href: string; icon: React.ElementType; exact?: boolean }) {
    const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
    return (
      <li>
        <Link
          href={href}
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
            active
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {label}
        </Link>
      </li>
    );
  }

  return (
    <nav className="flex flex-col gap-6 px-3 py-4">
      <form onSubmit={handleSearch} className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search everything…"
          aria-label="Search artifacts"
          className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:ring-1 focus:ring-ring"
        />
      </form>

      <div>
        <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Main
        </p>
        <ul className="space-y-0.5">
          {MAIN_NAV.map((item) => <NavItem key={item.href} {...item} />)}
        </ul>
      </div>

      <div>
        <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Settings
        </p>
        <ul className="space-y-0.5">
          {SETTINGS_NAV.map((item) => <NavItem key={item.href} {...item} />)}
          {isSuperAdmin && (
            <>
              <NavItem label="Users" href="/settings/users" icon={Users} />
              <NavItem label="Audit log" href="/settings/audit" icon={ShieldCheck} />
            </>
          )}
        </ul>
      </div>

      {/* Theme toggle */}
      <div className="mt-auto">
        <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Appearance
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2.5 text-muted-foreground hover:text-foreground"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {mounted && theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {mounted && theme === "dark" ? "Light mode" : "Dark mode"}
        </Button>
      </div>
    </nav>
  );
}
