import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SidebarNav } from "./_components/sidebar-nav";
import { MobileHeader } from "./_components/mobile-header";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/auth/signin");

  const displayName = session.user?.name ?? session.user?.email ?? "User";
  const isSuperAdmin = session.user?.systemRole === "superadmin";

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Desktop sidebar ───────────────────────────────────────────────── */}
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r bg-card">
        <div className="flex h-14 items-center border-b px-5">
          <Link href="/" className="text-base font-bold tracking-tight">
            prompt-hub
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto">
          <SidebarNav isSuperAdmin={isSuperAdmin} />
        </div>

        <div className="border-t px-3 py-3">
          <div className="mb-1 truncate px-2 text-sm font-medium">{displayName}</div>
          {session.user?.systemRole === "superadmin" && (
            <div className="mb-2 px-2">
              <Badge variant="secondary">superadmin</Badge>
            </div>
          )}
          <form action={async () => { "use server"; await signOut({ redirectTo: "/auth/signin" }); }}>
            <Button type="submit" variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
              Sign out
            </Button>
          </form>
        </div>
      </aside>

      {/* ── Mobile header + drawer ────────────────────────────────────────── */}
      <MobileHeader displayName={displayName} isSuperAdmin={isSuperAdmin} />

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  );
}
