import { createHash, randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import type { DbClient } from "@/server/db/types";
import { mcpTokens, users } from "@/server/db/schema";
import { parseScope, type TokenScope } from "./scope";

const PREFIX = "mcp_";
const PREFIX_LEN = 8; // characters shown in UI after "mcp_"

export function generateRawToken(): string {
  return PREFIX + randomBytes(32).toString("hex");
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function tokenPrefix(raw: string): string {
  return raw.slice(0, PREFIX.length + PREFIX_LEN);
}

/** Verify a raw token and return the associated user + token row, or null. */
export async function verifyMcpToken(
  raw: string,
  db: DbClient,
): Promise<{ userId: string; systemRole: "user" | "superadmin"; tokenId: string; scope: TokenScope } | null> {
  if (!raw.startsWith(PREFIX)) return null;

  const hash = hashToken(raw);
  const row = await db.query.mcpTokens.findFirst({
    where: eq(mcpTokens.tokenHash, hash),
  });
  if (!row) return null;
  if (row.expiresAt && row.expiresAt < new Date()) return null;

  const user = await db.query.users.findFirst({ where: eq(users.id, row.userId) });
  if (!user) return null;

  // Update last used (fire-and-forget). drizzle query builders are lazy
  // thenables — execute() only runs once something calls .then()/.catch(),
  // so the .catch() below isn't just error handling, it's what makes this
  // write actually reach the database instead of silently no-op'ing.
  db.update(mcpTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(mcpTokens.id, row.id))
    .catch((err) => console.error("[verifyMcpToken] lastUsedAt update failed", row.id, err));

  return { userId: user.id, systemRole: user.systemRole, tokenId: row.id, scope: parseScope(row.scope) };
}
