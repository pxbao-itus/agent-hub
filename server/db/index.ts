import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString && process.env.NODE_ENV !== "production") {
  console.warn("[db] DATABASE_URL is not set — DB queries will fail until configured.");
}

// Reuse the pool across hot-reloads in dev to avoid exhausting connections.
// Not throwing at import time: pg connects lazily on first query, so next build works without a DB.
const globalForDb = globalThis as unknown as { pool?: Pool };
const pool = globalForDb.pool ?? new Pool({ connectionString });
if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema });
export { schema };
