import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { verifyPassword } from "@/server/auth/password";
import { getRateLimiter, getClientIp } from "@/server/lib/rate-limit";
import { rateLimitConfig } from "@/server/lib/rate-limit/config";

/**
 * Credentials sign-in logic, kept out of auth.ts so it imports no `next-auth`
 * (which doesn't resolve cleanly under vitest) — this way the login path,
 * including its rate limit, is directly integration-testable. auth.ts wires
 * this as the Credentials provider's `authorize`.
 */

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type AuthorizedUser = {
  id: string;
  email: string;
  name: string | null;
  systemRole: "user" | "superadmin";
};

/**
 * Per-IP brute-force throttling then password check. The rate limit counts
 * every attempt in the window, so once over the threshold we reject even a
 * correct password until it drains — the standard fixed-window sign-in
 * throttle. Auth.js surfaces a null return as a generic sign-in failure
 * (indistinguishable from a wrong password), which is the desired opaque
 * behaviour.
 */
export async function authorizeCredentials(
  credentials: unknown,
  request: Request | undefined,
): Promise<AuthorizedUser | null> {
  const { max, windowMs } = rateLimitConfig.login;
  const { ok } = await getRateLimiter().consume(`login:${getClientIp(request)}`, { max, windowMs });
  if (!ok) return null;

  const parsed = credentialsSchema.safeParse(credentials);
  if (!parsed.success) return null;

  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, parsed.data.email),
  });
  if (!user?.passwordHash) return null;

  const valid = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!valid) return null;

  return { id: user.id, email: user.email, name: user.name, systemRole: user.systemRole };
}
