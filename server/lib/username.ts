import { eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { users } from "@/server/db/schema";
import type { DbClient } from "@/server/db/types";

type UsernameDb = Pick<DbClient, "query" | "update">;

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
export const USERNAME_REGEX = /^[a-z][a-z0-9]{2,31}$/;

export const RESERVED_USERNAMES = new Set([
  "admin",
  "root",
  "system",
  "deleted",
  "everyone",
  "here",
  "all",
  "me",
]);

export const usernameSchema = z
  .string()
  .min(USERNAME_MIN_LENGTH)
  .max(USERNAME_MAX_LENGTH)
  .regex(USERNAME_REGEX, "Username must start with a letter and contain only lowercase letters and numbers.")
  .refine((value) => !RESERVED_USERNAMES.has(value), "This username is reserved.");

export type UsernameValidation =
  | { ok: true; username: string }
  | { ok: false; message: string };

export function validateUsername(value: string): UsernameValidation {
  const parsed = usernameSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid username." };
  }
  return { ok: true, username: parsed.data };
}

/** Produce a safe allocation candidate for OAuth/backfill; never use for user-entered validation. */
export function normalizeUsernameCandidate(value: string): string {
  let normalized = value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  if (!normalized) normalized = "user";
  if (!/^[a-z]/.test(normalized)) normalized = `u${normalized}`;
  if (normalized.length < USERNAME_MIN_LENGTH) normalized = `${normalized}user`;
  normalized = normalized.slice(0, USERNAME_MAX_LENGTH);
  if (RESERVED_USERNAMES.has(normalized)) normalized = `${normalized}user`;
  return normalized.slice(0, USERNAME_MAX_LENGTH);
}

/** Return the first globally available canonical handle, using deterministic numeric suffixes. */
export async function allocateUniqueUsername(candidate: string, db: UsernameDb): Promise<string> {
  const base = normalizeUsernameCandidate(candidate);
  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const suffixText = suffix === 0 ? "" : String(suffix + 1);
    const username = `${base.slice(0, USERNAME_MAX_LENGTH - suffixText.length)}${suffixText}`;
    const existing = await db.query.users.findFirst({
      where: eq(users.username, username),
      columns: { id: true },
    });
    if (!existing) return username;
  }
  throw new Error("Could not allocate a unique username.");
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

/** Assign a generated username to one legacy/OAuth user, retrying allocation races. */
export async function assignGeneratedUsername(
  userId: string,
  candidate: string,
  db: UsernameDb,
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const username = await allocateUniqueUsername(candidate, db);
    try {
      await db
        .update(users)
        .set({ username, updatedAt: new Date() })
        .where(sql`${users.id} = ${userId} and ${users.username} is null`);
      return username;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new Error("Could not assign a unique username.");
}

/** Extract canonical @username tokens without treating the domain part of an email as a mention. */
export function extractMentionUsernames(markdown: string): string[] {
  const found = new Set<string>();
  const pattern = /(^|[^a-zA-Z0-9_@])@([a-z][a-z0-9]{2,31})\b/g;
  for (const match of markdown.matchAll(pattern)) {
    const username = match[2];
    if (username && !RESERVED_USERNAMES.has(username)) found.add(username);
  }
  return [...found];
}

/**
 * Idempotently allocate handles for legacy users. The transaction-scoped
 * advisory lock makes concurrent container starts serialize this data step.
 */
export async function backfillMissingUsernames(db: DbClient): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('agent-hub:username-backfill'))`);
    const missing = await tx.query.users.findMany({
      where: isNull(users.username),
      columns: { id: true, name: true, email: true },
      orderBy: users.createdAt,
    });

    let updated = 0;
    for (const user of missing) {
      const emailLocal = user.email.split("@")[0] ?? "";
      const candidate = emailLocal || user.name || `user${user.id.replaceAll("-", "").slice(0, 8)}`;
      await assignGeneratedUsername(user.id, candidate, tx);
      updated += 1;
    }
    return updated;
  });
}
