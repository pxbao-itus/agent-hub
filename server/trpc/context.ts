import { db } from "@/server/db";

/**
 * Context injected into every tRPC request.
 * Phase 2 will add `session` (authenticated user) from Auth.js.
 */
export async function createContext() {
  return {
    db,
    session: null as null | { userId: string },
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
