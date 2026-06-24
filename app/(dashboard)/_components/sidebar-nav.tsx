"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { LayoutDashboard, BookText, Building2, Key, Sun, Moon, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const MAIN_NAV = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard, exact: true },
  { label: "Prompts", href: "/prompts", icon: BookText },
];

const SETTINGS_NAV = [
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
  const { theme, setTheme } = useTheme();

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
            <NavItem label="Users" href="/settings/users" icon={Users} />
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
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </Button>
      </div>
    </nav>
  );
}
