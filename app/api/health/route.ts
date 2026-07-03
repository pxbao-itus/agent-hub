import { sql } from "drizzle-orm";
import { db } from "@/server/db";

export const runtime = "nodejs";

/**
 * Plain HTTP health probe for infra (docker HEALTHCHECK, load balancer,
 * uptime monitor) — distinct from the tRPC `health` procedure, which wraps
 * its response in a tRPC/superjson envelope not meant for probes. No auth:
 * probes need to reach it, and it only ever reveals a boolean.
 */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, db: true }, { status: 200 });
  } catch {
    return Response.json({ ok: false, db: false }, { status: 503 });
  }
}
