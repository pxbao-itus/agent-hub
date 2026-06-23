import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { eq } from "drizzle-orm";
import { z } from "zod";

const registerSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  }

  const { name, email, password } = parsed.data;

  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  });
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  await db.insert(schema.users).values({ name, email, passwordHash });

  return NextResponse.json({ ok: true }, { status: 201 });
}
