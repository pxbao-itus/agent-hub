import { db } from "@/server/db";
import { auth } from "@/auth";

/**
 * Context injected into every tRPC request.
 */
export async function createContext() {
  const session = await auth();
  return {
    db,
    session: session?.user?.id ? { userId: session.user.id } : null,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
