import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString && process.env.NODE_ENV !== "production") {
  console.warn("[db] DATABASE_URL is not set — DB queries will fail until configured.");
}

// Reuse the pool across hot-reloads in dev to avoid exhausting connections.
// Not throwing at import time: pg connects lazily on first query, so next build works without a DB.
//
// Pool sizing is env-overridable, not hardcoded — the app is stateless and
// scales horizontally (CLAUDE.md), so `max` here is *per instance*: total
// connections against Postgres is max × instance count, which must stay
// under Postgres's own max_connections. Defaults match pg's own (max=10,
// idle=10s) except connectionTimeoutMillis, which pg leaves unbounded by
// default — a DB that's down or unreachable would otherwise hang requests
// indefinitely instead of failing fast.
const globalForDb = globalThis as unknown as { pool?: Pool };
const pool =
  globalForDb.pool ??
  new Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_MS ?? 10_000),
    connectionTimeoutMillis: Number(process.env.DB_POOL_CONN_TIMEOUT_MS ?? 10_000),
  });
if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema });
export { schema };
