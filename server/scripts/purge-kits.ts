import "dotenv/config";
import { Pool, type PoolClient } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Kit purge failed: DATABASE_URL is not set.");
  process.exit(1);
}

const pool = new Pool({ connectionString, max: 1 });

async function tableExists(client: PoolClient, tableName: string) {
  const { rows } = await client.query<{ exists: boolean }>(
    "select to_regclass($1) is not null as exists",
    [`public.${tableName}`],
  );
  return rows[0]?.exists ?? false;
}

const client = await pool.connect();
try {
  await client.query("begin");
  await client.query(
    "select pg_advisory_xact_lock(hashtext('agent-hub:purge-kits'))",
  );

  if (!(await tableExists(client, "artifacts"))) {
    await client.query("commit");
    console.log("Kit purge complete (fresh database; nothing to remove).");
    process.exitCode = 0;
  } else {
    const kitCountResult = await client.query<{ count: string }>(
      "select count(*)::text as count from artifacts where kind = 'kit'",
    );
    const kitCount = Number(kitCountResult.rows[0]?.count ?? 0);

    let memberCount = 0;
    if (await tableExists(client, "artifact_members")) {
      const memberCountResult = await client.query<{ count: string }>(
        "select count(*)::text as count from artifact_members",
      );
      memberCount = Number(memberCountResult.rows[0]?.count ?? 0);
    }

    const deleted = await client.query(
      "delete from artifacts where kind = 'kit'",
    );

    const remainingResult = await client.query<{ count: string }>(
      "select count(*)::text as count from artifacts where kind = 'kit'",
    );
    const remaining = Number(remainingResult.rows[0]?.count ?? 0);
    if (remaining !== 0) {
      throw new Error(`Kit purge incomplete: ${remaining} artifact(s) remain.`);
    }

    if (await tableExists(client, "artifact_members")) {
      const orphanResult = await client.query<{ count: string }>(
        "select count(*)::text as count from artifact_members",
      );
      const orphanCount = Number(orphanResult.rows[0]?.count ?? 0);
      if (orphanCount !== 0) {
        throw new Error(
          `Kit purge incomplete: ${orphanCount} member relation(s) remain.`,
        );
      }
    }

    await client.query("commit");
    console.log(
      `Kit purge complete (${deleted.rowCount ?? kitCount} artifact(s), ${memberCount} member relation(s) removed).`,
    );
  }
} catch (error) {
  await client.query("rollback");
  console.error(
    "Kit purge failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
