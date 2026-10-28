import "dotenv/config";

/**
 * Ad-hoc query-count harness for performance work. Counts every SQL
 * statement issued against Postgres for a given operation, by monkey-patching
 * Pool.prototype.query (what drizzle-orm/node-postgres calls per-statement
 * for non-transaction queries — confirmed by reading its session.js) before
 * anything under measurement imports the shared db singleton.
 *
 * Not part of any request path — run manually: `pnpm exec tsx server/scripts/measure-queries.ts`.
 * Requires TEST_DATABASE_URL (points DATABASE_URL at the seeded test DB so
 * this never touches dev data) and a fresh `pnpm db:seed:test`.
 */

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL must be set (see server/db/seed-test.ts).");
const dbName = new URL(testUrl).pathname.replace(/^\//, "");
if (!dbName.endsWith("_test")) {
  throw new Error(`TEST_DATABASE_URL must point at a database ending in "_test" (got "${dbName}").`);
}
process.env.DATABASE_URL = testUrl;

const { Pool } = await import("pg");
let queryCount = 0;
let queryLog: string[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalQuery: (...args: any[]) => any = Pool.prototype.query;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Pool.prototype as any).query = function (this: unknown, ...args: any[]) {
  queryCount++;
  const text = typeof args[0] === "string" ? args[0] : args[0]?.text;
  if (text) queryLog.push(text.trim().split("\n")[0].slice(0, 80));
  return originalQuery.apply(this, args);
};

function reset() {
  queryCount = 0;
  queryLog = [];
}

function report(label: string, verbose = false) {
  console.log(`\n${label}: ${queryCount} quer${queryCount === 1 ? "y" : "ies"}`);
  if (verbose) {
    for (const q of queryLog) console.log(`  - ${q}`);
  }
}

async function main() {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../db");
  const schema = await import("../db/schema");
  const { createMcpServer } = await import("../mcp/server");

  const [engMember] = await db.select().from(schema.users).where(eq(schema.users.email, "eng-member@test.local"));
  if (!engMember) throw new Error("seed fixture not found — run `pnpm db:seed:test` first");

  reset();
  await createMcpServer({ userId: engMember.id, systemRole: "user" }, {});
  report("createMcpServer(engMember, scope={})", process.argv.includes("--verbose"));

  reset();
  await createMcpServer({ userId: engMember.id, systemRole: "user" }, { write: true });
  report("createMcpServer(engMember, scope={write:true})");

  // A representative list-page read: same shape as app/(dashboard)/prompts/page.tsx's
  // browse-without-query branch (accessCondition + tag list), the most-hit page.
  const { getAccessibleGroups, getSharedArtifactIds } = await import("../auth/access");
  reset();
  await getAccessibleGroups(engMember.id, db);
  await getSharedArtifactIds(engMember.id, db);
  report("list-page access resolution (getAccessibleGroups + getSharedArtifactIds), once");

  // get_skill via two separate /api/mcp-equivalent requests (two fresh
  // createMcpServer calls, matching the real stateless HTTP transport) —
  // the second call should cost zero extra queries for the skill's own
  // content once its version id has been resolved once.
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  async function callGetSkill() {
    const server = await createMcpServer({ userId: engMember.id, systemRole: "user" }, {});
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "measure-script", version: "0.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client.callTool({ name: "get_skill", arguments: { slug: "pr-review-checklist" } });
  }

  reset();
  await callGetSkill();
  report("1st createMcpServer + get_skill call (cold — version content not yet cached)");

  reset();
  await callGetSkill();
  report("2nd createMcpServer + get_skill call, same skill (server rebuilt fresh, but version content cache hit)");

  process.exit(0);
}

main();
