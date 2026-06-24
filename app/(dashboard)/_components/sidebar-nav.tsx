"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BookText,
  Building2,
  Key,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  {
    group: "Main",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard, exact: true },
      { label: "Prompts", href: "/prompts", icon: BookText },
    ],
  },
  {
    group: "Settings",
    items: [
      { label: "Organizations", href: "/settings/orgs", icon: Building2 },
      { label: "MCP Tokens", href: "/settings/tokens", icon: Key },
    ],
  },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-6 px-3 py-4">
      {NAV.map((group) => (
        <div key={group.group}>
          <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {group.group}
          </p>
          <ul className="space-y-0.5">
            {group.items.map(({ label, href, icon: Icon, exact }) => {
              const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
              return (
                <li key={href}>
                  <Link
                    href={href}
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
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
