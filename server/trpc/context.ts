import { db } from "@/server/db";

/**
 * Context cho mỗi request tRPC.
 * Phase 2 sẽ thêm `session` (user đã đăng nhập) từ Auth.js.
 */
export async function createContext() {
  return {
    db,
    session: null as null | { userId: string },
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
