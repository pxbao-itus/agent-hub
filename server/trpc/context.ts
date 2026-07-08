import { db } from "@/server/db";
import { auth } from "@/auth";
import { resolveSession } from "./resolve-session";

export type { RequestSession } from "./resolve-session";

/**
 * Context injected into every tRPC request.
 */
export async function createContext() {
  const session = await auth();
  return {
    db,
    session: await resolveSession(session?.user, db),
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
