import "dotenv/config";
import { db } from "./index";
import {
  orgs,
  departments,
  teams,
  users,
  memberships,
  artifacts,
  artifactVersions,
  artifactVariables,
} from "./schema";
import { eq } from "drizzle-orm";

/**
 * Seeds sample data: one org → department → team, one user as team member,
 * and one prompt owned by the team (with a version and variables).
 * Run: pnpm db:seed (requires DATABASE_URL).
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
    .values({ name: "Demo User", username: "demouser", email: "demo@example.com" })
    .returning();

  // Membership stored at the lowest level (team); org/dept access is derived via hierarchy (option A).
  await db.insert(memberships).values({
    userId: user.id,
    groupType: "team",
    groupId: team.id,
    role: "admin",
  });

  const [prompt] = await db
    .insert(artifacts)
    .values({
      kind: "prompt",
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
    .insert(artifactVersions)
    .values({
      artifactId: prompt.id,
      versionNo: 1,
      body: "Review the following {{language}} code and suggest improvements:\n\n{{code}}",
      changelog: "Initial version",
      createdBy: user.id,
    })
    .returning();

  await db
    .update(artifacts)
    .set({ currentVersionId: version.id })
    .where(eq(artifacts.id, prompt.id));

  await db.insert(artifactVariables).values([
    { artifactId: prompt.id, name: "language", type: "string", required: true },
    { artifactId: prompt.id, name: "code", type: "string", required: true },
  ]);

  console.log("Done. Seeded org=%s team=%s prompt=%s", org.slug, team.slug, prompt.title);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
