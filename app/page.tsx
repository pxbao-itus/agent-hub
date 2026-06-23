import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const session = await auth();
  if (!session) redirect("/auth/signin");

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">prompt-hub</h1>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/auth/signin" });
          }}
        >
          <Button type="submit" variant="outline" size="sm">Sign out</Button>
        </form>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Welcome, {session.user?.name ?? session.user?.email}
      </p>
      <div className="mt-8 rounded-lg border p-4 text-sm text-muted-foreground">
        More features coming soon.
      </div>
    </main>
  );
}
