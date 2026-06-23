/**
 * Bootstrap a superadmin account.
 * If the user already exists, promotes them. Otherwise creates them.
 *
 * Usage:
 *   ROOT_EMAIL=admin@example.com ROOT_PASSWORD=secret pnpm exec tsx server/scripts/create-superadmin.ts
 *   — or via Makefile: make db/create-root email=admin@example.com password=secret
 *
 * Note: re-login is required after promotion for the new role to appear in the JWT.
 */

import "dotenv/config";
import { db } from "../db";
import { users } from "../db/schema";
import { hashPassword } from "../auth/password";
import { eq } from "drizzle-orm";

const email = process.env.ROOT_EMAIL;
const password = process.env.ROOT_PASSWORD;

if (!email || !password) {
  console.error("Error: ROOT_EMAIL and ROOT_PASSWORD must be set.");
  process.exit(1);
}

const existing = await db.query.users.findFirst({ where: eq(users.email, email) });

if (existing) {
  await db.update(users).set({ systemRole: "superadmin" }).where(eq(users.id, existing.id));
  console.log(`Promoted existing user "${email}" to superadmin.`);
} else {
  await db.insert(users).values({
    email,
    name: "Root",
    passwordHash: await hashPassword(password),
    systemRole: "superadmin",
  });
  console.log(`Created superadmin account: ${email}`);
}

process.exit(0);
