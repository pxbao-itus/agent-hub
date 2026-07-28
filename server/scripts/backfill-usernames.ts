import "dotenv/config";
import { isNull } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import { backfillMissingUsernames } from "../lib/username";

const updated = await backfillMissingUsernames(db);
const remaining = await db.query.users.findFirst({
  where: isNull(users.username),
  columns: { id: true },
});

if (remaining) {
  console.error("Username backfill incomplete: at least one user still has no username.");
  process.exit(1);
}

console.log(`Username backfill complete (${updated} user${updated === 1 ? "" : "s"} updated).`);
process.exit(0);
