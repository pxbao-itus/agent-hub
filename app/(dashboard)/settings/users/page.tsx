import type { Metadata } from "next";
import { auth } from "@/auth";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { users, memberships } from "@/server/db/schema";
import { eq, and, or, ilike, count, sql } from "drizzle-orm";
import { UserTable } from "./_components/user-table";
import { CreateUserDialog } from "./_components/create-user-dialog";

export const metadata: Metadata = { title: "User Management" };

type SearchParams = { q?: string; offset?: string };

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (session?.user?.systemRole !== "superadmin") notFound();

  const { q, offset: offsetStr } = await searchParams;
  const query = q?.trim() ?? "";
  const offset = Math.max(0, parseInt(offsetStr ?? "0", 10) || 0);
  const limit = 20;

  const likeQ = query ? `%${query}%` : undefined;
  const whereClause = likeQ
    ? or(ilike(users.name, likeQ), ilike(users.email, likeQ))
    : undefined;

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
      systemRole: users.systemRole,
      hasPassword: sql<boolean>`(${users.passwordHash} is not null)`,
      createdAt: users.createdAt,
      orgCount: count(memberships.id),
    })
    .from(users)
    .leftJoin(
      memberships,
      and(eq(memberships.userId, users.id), eq(memberships.groupType, "org")),
    )
    .where(whereClause)
    .groupBy(users.id)
    .orderBy(users.createdAt)
    .limit(limit)
    .offset(offset);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">User Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Create, edit, and delete platform users. Superadmin only.
          </p>
        </div>
        <CreateUserDialog />
      </div>

      <UserTable
        users={rows}
        currentUserId={session.user!.id!}
        query={query}
        offset={offset}
        limit={limit}
        hasMore={rows.length === limit}
      />
    </div>
  );
}
