"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarNav } from "./sidebar-nav";

export function MobileHeader({ displayName, isSuperAdmin }: { displayName: string; isSuperAdmin?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Topbar */}
      <header className="flex h-14 items-center justify-between border-b bg-card px-4 md:hidden">
        <Link href="/" className="text-base font-bold tracking-tight">
          Agent Hub
        </Link>
        <Button variant="ghost" size="icon" onClick={() => setOpen(true)}>
          <Menu className="h-5 w-5" />
          <span className="sr-only">Open menu</span>
        </Button>
      </header>

      {/* Drawer overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer panel */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-card transition-transform duration-200 md:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 items-center justify-between border-b px-5">
          <Link href="/" className="text-base font-bold tracking-tight">
            Agent Hub
          </Link>
          <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <SidebarNav onNavigate={() => setOpen(false)} isSuperAdmin={isSuperAdmin} />
        </div>

        <div className="border-t px-3 py-3">
          <div className="truncate px-2 text-sm font-medium">{displayName}</div>
        </div>
      </aside>
    </>
  );
}
