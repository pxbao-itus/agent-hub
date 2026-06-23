import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString && process.env.NODE_ENV !== "production") {
  console.warn("[db] DATABASE_URL chưa được set — truy vấn DB sẽ lỗi cho tới khi cấu hình.");
}

// Tái dùng pool qua hot-reload ở dev để tránh cạn connection.
// Không throw lúc import: pg chỉ kết nối khi có query đầu tiên → next build không cần DB.
const globalForDb = globalThis as unknown as { pool?: Pool };
const pool = globalForDb.pool ?? new Pool({ connectionString });
if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema });
export { schema };
