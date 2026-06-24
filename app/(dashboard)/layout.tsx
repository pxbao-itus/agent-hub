import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SidebarNav } from "./_components/sidebar-nav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/auth/signin");

  const displayName = session.user?.name ?? session.user?.email ?? "User";

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="flex w-56 shrink-0 flex-col border-r bg-card">
        {/* Logo */}
        <div className="flex h-14 items-center border-b px-5">
          <Link href="/" className="text-base font-bold tracking-tight">
            prompt-hub
          </Link>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto">
          <SidebarNav />
        </div>

        {/* User */}
        <div className="border-t px-3 py-3">
          <div className="mb-1 truncate px-2 text-sm font-medium">{displayName}</div>
          {session.user?.systemRole === "superadmin" && (
            <div className="mb-2 px-2">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                superadmin
              </span>
            </div>
          )}
          <form action={async () => { "use server"; await signOut({ redirectTo: "/auth/signin" }); }}>
            <Button type="submit" variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
              Sign out
            </Button>
          </form>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
