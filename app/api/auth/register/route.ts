import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getRateLimiter, getClientIp } from "@/server/lib/rate-limit";
import { rateLimitConfig } from "@/server/lib/rate-limit/config";
import { usernameSchema } from "@/server/lib/username";

const registerSchema = z.object({
  name: z.string().min(1).max(100),
  username: usernameSchema,
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export async function POST(req: NextRequest) {
  const { max, windowMs } = rateLimitConfig.register;
  const { ok, retryAfterMs } = await getRateLimiter().consume(`register:${getClientIp(req)}`, { max, windowMs });
  if (!ok) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  }

  const { name, username, email, password } = parsed.data;

  const [existingEmail, existingUsername] = await Promise.all([
    db.query.users.findFirst({ where: eq(schema.users.email, email) }),
    db.query.users.findFirst({ where: eq(schema.users.username, username) }),
  ]);
  if (existingEmail || existingUsername) {
    return NextResponse.json(
      { error: existingEmail ? "An account with this email already exists." : "This username is already in use." },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(password);
  try {
    await db.insert(schema.users).values({ name, username, email, passwordHash });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "Email or username is already in use." }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
