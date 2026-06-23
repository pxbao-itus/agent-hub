import "dotenv/config";
import { db } from "./index";
import {
  orgs,
  departments,
  teams,
  users,
  memberships,
  prompts,
  promptVersions,
  promptVariables,
} from "./schema";
import { eq } from "drizzle-orm";

/**
 * Seed dữ liệu mẫu: một org → department → team, một user là thành viên team,
 * và một prompt do team sở hữu (có version + biến).
 * Chạy: pnpm db:seed (cần DATABASE_URL).
 */
async function main() {
  console.log("Seeding…");

  const [org] = await db
    .insert(orgs)
    .values({ name: "Acme", slug: "acme" })
    .returning();

  const [dept] = await db
    .insert(departments)
    .values({ orgId: org.id, name: "Engineering", slug: "engineering" })
    .returning();

  const [team] = await db
    .insert(teams)
    .values({ departmentId: dept.id, name: "Backend", slug: "backend" })
    .returning();

  const [user] = await db
    .insert(users)
    .values({ name: "Demo User", email: "demo@example.com" })
    .returning();

  // Membership ở cấp thấp nhất (team) — quyền org/dept suy ra qua hierarchy.
  await db.insert(memberships).values({
    userId: user.id,
    groupType: "team",
    groupId: team.id,
    role: "admin",
  });

  // Prompt do team sở hữu, kèm một version và một biến.
  const [prompt] = await db
    .insert(prompts)
    .values({
      ownerType: "team",
      ownerId: team.id,
      title: "Code review",
      description: "Review a diff and suggest improvements.",
      tags: ["engineering", "review"],
      visibility: "group",
      createdBy: user.id,
    })
    .returning();

  const [version] = await db
    .insert(promptVersions)
    .values({
      promptId: prompt.id,
      versionNo: 1,
      body: "Review the following {{language}} code and suggest improvements:\n\n{{code}}",
      changelog: "Initial version",
      createdBy: user.id,
    })
    .returning();

  await db
    .update(prompts)
    .set({ currentVersionId: version.id })
    .where(eq(prompts.id, prompt.id));

  await db.insert(promptVariables).values([
    { promptId: prompt.id, name: "language", type: "string", required: true },
    { promptId: prompt.id, name: "code", type: "string", required: true },
  ]);

  console.log("Done. Seeded org=%s team=%s prompt=%s", org.slug, team.slug, prompt.title);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
