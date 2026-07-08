import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";

type SessionUser = { id?: string | null; systemRole?: "user" | "superadmin" | null } | undefined;
export type RequestSession = { userId: string; systemRole: "user" | "superadmin" } | null;

/**
 * Turns the raw auth() session into the tRPC session, dropping it to null if
 * the JWT's userId no longer exists in the DB.
 *
 * JWT sessions are stateless: the userId is baked into the cookie at sign-in
 * and never re-validated afterwards (auth.ts's jwt callback only hits the DB
 * when `user` is set, i.e. at login). So a session survives the user being
 * deleted or the DB being reseeded — the cookie stays "valid" while pointing
 * at a row that's gone. Without this guard, such an orphaned session sails
 * through protectedProcedure and blows up at the first FK-constrained write
 * (e.g. token.create) with a raw 500 instead of a clean UNAUTHORIZED.
 *
 * This lives outside auth.ts's session/jwt callbacks on purpose: those
 * callbacks also run inside the Edge middleware (proxy.ts), which can't use
 * `pg` (D-031). The tRPC context only runs in the Node runtime, so the DB
 * check is safe here. It's also a standalone module (not inlined into
 * context.ts) so it's unit-testable — importing context.ts pulls in
 * `next-auth`, which doesn't load under Vitest (same reason authorizeCredentials
 * was extracted in Phase 46). Cost is one indexed PK lookup per tRPC HTTP
 * request (context is built once per request, not per batched procedure).
 */
export async function resolveSession(user: SessionUser, database: DbClient): Promise<RequestSession> {
  const userId = user?.id;
  if (!userId) return null;

  const exists = await database.query.users.findFirst({
    where: eq(schema.users.id, userId),
    columns: { id: true },
  });
  if (!exists) return null;

  return { userId, systemRole: user?.systemRole ?? "user" };
}
