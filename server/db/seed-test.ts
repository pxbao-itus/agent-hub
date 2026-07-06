import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, sql } from "drizzle-orm";
import * as schema from "./schema";
import { hashPassword } from "../auth/password";

/**
 * Resets and seeds bilingual (VN/EN) fixtures for the qa/ e2e harness and
 * integration tests. Truncates every app table first, so this is destructive
 * by design — the TEST_DATABASE_URL guard below exists to make sure that
 * destruction can only ever land on a disposable "*_test" database, never on
 * dev/production data.
 *
 * Usage:
 *   TEST_DATABASE_URL=postgresql://.../agenthub_test pnpm db:seed:test
 *   — or rely on TEST_DATABASE_URL already set in .env.
 *
 * All seeded users share PASSWORD below (Credentials auth) so e2e specs can
 * log in as any of them without per-user secrets.
 *
 * MCP tokens are intentionally NOT seeded here — tests that need one should
 * generate it through the real token.create mutation, exercising the actual
 * hashing/scope code path instead of a re-implementation in this script.
 */

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) {
  console.error("Error: TEST_DATABASE_URL must be set (refusing to guess — this script truncates data).");
  process.exit(1);
}

const dbName = new URL(connectionString).pathname.replace(/^\//, "");
if (!dbName.endsWith("_test")) {
  console.error(
    `Error: TEST_DATABASE_URL must point at a database whose name ends in "_test" (got "${dbName}"). ` +
      "Refusing to run a destructive seed against what looks like a non-test database.",
  );
  process.exit(1);
}

const pool = new Pool({ connectionString });
const db = drizzle(pool, { schema });

export const PASSWORD = "Test1234!";

async function reset() {
  // Children before parents documents the dependency graph; CASCADE is the
  // actual safety net in case that order ever drifts from the schema.
  await db.execute(sql`
    TRUNCATE TABLE
      audit_events, workflow_stage_artifacts, workflow_stages, workflows,
      project_artifacts, project_members, projects,
      artifact_links, artifact_shares, artifact_tasks, artifact_members,
      artifact_files, artifact_embeddings, artifact_variables, artifact_versions,
      artifacts, mcp_tokens, memberships, teams, departments, orgs,
      sessions, accounts, verification_tokens, users
    RESTART IDENTITY CASCADE
  `);
}

type OwnerType = "user" | "org" | "department" | "team";
type Visibility = "private" | "group" | "public";

async function createArtifact(opts: {
  kind: schema.ArtifactKind;
  ownerType: OwnerType;
  ownerId: string;
  title: string;
  slug?: string;
  description?: string;
  tags?: string[];
  visibility: Visibility;
  createdBy: string;
  body: string;
  variables?: { name: string; type?: string; required?: boolean }[];
}) {
  const [artifact] = await db
    .insert(schema.artifacts)
    .values({
      kind: opts.kind,
      ownerType: opts.ownerType,
      ownerId: opts.ownerId,
      title: opts.title,
      slug: opts.slug,
      description: opts.description,
      tags: opts.tags ?? [],
      visibility: opts.visibility,
      createdBy: opts.createdBy,
    })
    .returning();

  const [version] = await db
    .insert(schema.artifactVersions)
    .values({
      artifactId: artifact.id,
      versionNo: 1,
      body: opts.body,
      changelog: "Initial version",
      createdBy: opts.createdBy,
    })
    .returning();

  await db
    .update(schema.artifacts)
    .set({ currentVersionId: version.id })
    .where(eq(schema.artifacts.id, artifact.id));

  if (opts.variables?.length) {
    await db.insert(schema.artifactVariables).values(
      opts.variables.map((v) => ({
        artifactId: artifact.id,
        name: v.name,
        type: v.type ?? "string",
        required: v.required ?? false,
      })),
    );
  }

  return { artifact: { ...artifact, currentVersionId: version.id }, version };
}

async function main() {
  console.log(`Seeding bilingual test fixtures into "${dbName}"…`);
  await reset();

  const passwordHash = await hashPassword(PASSWORD);

  // ---- Users --------------------------------------------------------------
  // superadmin: bypasses all access checks.
  // orgAdmin: org-level admin membership (gate for dept/team management;
  //   also proves mutate/share authority flows down to descendant groups).
  // orgViewer: org-level VIEWER membership — no admin/editor role anywhere.
  //   Proves READ inherits downward for every role (D-016), not just admin:
  //   orgViewer must see descendant group artifacts but must NOT be able to
  //   mutate/share them (that's still admin/editor-only, effectiveGroupRole
  //   is unchanged by D-016).
  // engMember: team-level member of Backend (inherits Engineering + QA Org).
  // marketingMember: team-level member of Content (inherits Marketing + QA Org)
  //   — used as the negative case: must NOT see Backend/Engineering-only
  //   group artifacts, except the one explicitly shared with them below.
  // outsider: no membership anywhere — must only see "public" artifacts.
  const [, orgAdmin, engMember, marketingMember, , orgViewer] = await db
    .insert(schema.users)
    .values([
      { name: "QA Superadmin", email: "superadmin@test.local", passwordHash, systemRole: "superadmin" },
      { name: "QA Org Admin", email: "org-admin@test.local", passwordHash },
      { name: "QA Eng Member", email: "eng-member@test.local", passwordHash },
      { name: "QA Marketing Member", email: "marketing-member@test.local", passwordHash },
      { name: "QA Outsider", email: "outsider@test.local", passwordHash },
      { name: "QA Org Viewer", email: "org-viewer@test.local", passwordHash },
    ])
    .returning();

  // ---- Org hierarchy: 1 org → 2 dept → 2 team ------------------------------
  const [org] = await db.insert(schema.orgs).values({ name: "QA Org", slug: "qa-org" }).returning();
  const [engineering, marketing] = await db
    .insert(schema.departments)
    .values([
      { orgId: org.id, name: "Engineering", slug: "engineering" },
      { orgId: org.id, name: "Marketing", slug: "marketing" },
    ])
    .returning();
  const [backend, content] = await db
    .insert(schema.teams)
    .values([
      { departmentId: engineering.id, name: "Backend", slug: "backend" },
      { departmentId: marketing.id, name: "Content", slug: "content" },
    ])
    .returning();

  // ---- Memberships ----------------------------------------------------------
  // Read access (getAccessibleGroups) inherits both up AND down from each of
  // these (D-016) — e.g. orgAdmin/orgViewer's org membership also covers
  // Engineering/Marketing and Backend/Content. Mutate/share authority
  // (effectiveGroupRole) inherits DOWN only, and role still matters there:
  // orgAdmin can edit a descendant team's artifacts, orgViewer cannot.
  await db.insert(schema.memberships).values([
    { userId: orgAdmin.id, groupType: "org", groupId: org.id, role: "admin" },
    { userId: orgViewer.id, groupType: "org", groupId: org.id, role: "viewer" },
    { userId: engMember.id, groupType: "team", groupId: backend.id, role: "editor" },
    { userId: marketingMember.id, groupType: "team", groupId: content.id, role: "editor" },
  ]);

  // ---- Prompts --------------------------------------------------------------
  // #1 and #2 are deliberately worded so a *semantic* query (different
  // keywords, same meaning) should still surface them — see qa/cases/ for the
  // paired queries used to evaluate search quality against a real embedder.
  const { artifact: prompt1 } = await createArtifact({
    kind: "prompt",
    ownerType: "team",
    ownerId: backend.id,
    title: "Rà soát bảo mật mã nguồn",
    slug: "rasoat-baomat",
    description: "Kiểm tra lỗ hổng bảo mật trong một đoạn diff trước khi merge.",
    tags: ["security", "review"],
    visibility: "group",
    createdBy: engMember.id,
    body: "Rà soát đoạn diff sau và liệt kê mọi lỗ hổng bảo mật tiềm ẩn:\n\n{{diff}}",
    variables: [{ name: "diff", required: true }],
  });

  const { artifact: prompt2 } = await createArtifact({
    kind: "prompt",
    ownerType: "user",
    ownerId: engMember.id,
    title: "Summarize meeting notes",
    slug: "summarize-meeting-notes",
    description: "Condense a long transcript into action items.",
    tags: ["productivity"],
    visibility: "private",
    createdBy: engMember.id,
    body: "Summarize the following transcript into bullet-point action items:\n\n{{transcript}}",
    variables: [{ name: "transcript", required: true }],
  });

  const { artifact: prompt3 } = await createArtifact({
    kind: "prompt",
    ownerType: "org",
    ownerId: org.id,
    title: "Viết email xin nghỉ phép",
    slug: "email-xin-nghi-phep",
    description: "Mẫu email xin nghỉ phép gửi quản lý trực tiếp.",
    tags: ["hr", "email"],
    visibility: "public",
    createdBy: orgAdmin.id,
    body: "Viết email xin nghỉ phép từ {{ngay_bat_dau}} đến {{ngay_ket_thuc}}, gửi cho {{quan_ly}}.",
    variables: [
      { name: "ngay_bat_dau", required: true },
      { name: "ngay_ket_thuc", required: true },
      { name: "quan_ly", required: true },
    ],
  });

  // ---- Skills -----------------------------------------------------------
  const { artifact: skill1, version: skill1Version } = await createArtifact({
    kind: "skill",
    ownerType: "team",
    ownerId: backend.id,
    title: "PR review checklist",
    description: "Structured checklist for reviewing pull requests.",
    tags: ["engineering", "review"],
    visibility: "group",
    createdBy: engMember.id,
    body: "# PR review checklist\n\nSee checklist.md for the full list.",
  });
  await db.insert(schema.artifactFiles).values({
    artifactVersionId: skill1Version.id,
    path: "checklist.md",
    content: "- [ ] Tests pass\n- [ ] No secrets committed\n- [ ] Docs updated",
    mimeType: "text/markdown",
  });

  const { artifact: skill2, version: skill2Version } = await createArtifact({
    kind: "skill",
    ownerType: "department",
    ownerId: engineering.id,
    title: "Hướng dẫn viết test tự động",
    description: "Kỹ năng viết unit test và integration test chất lượng cao.",
    tags: ["testing"],
    visibility: "group",
    createdBy: engMember.id,
    body: "# Hướng dẫn viết test tự động\n\nXem huong-dan.md để biết chi tiết.",
  });
  await db.insert(schema.artifactFiles).values({
    artifactVersionId: skill2Version.id,
    path: "huong-dan.md",
    content: "1. Viết test trước khi fix bug\n2. Ưu tiên test hành vi, không test chi tiết cài đặt",
    mimeType: "text/markdown",
  });

  // Private, owned by marketingMember — negative-access fixture: engMember
  // must NOT see this (different team, not shared, not public).
  const { version: skill3Version } = await createArtifact({
    kind: "skill",
    ownerType: "user",
    ownerId: marketingMember.id,
    title: "Debug memory leaks in Node.js",
    description: "Heap snapshot workflow for tracking down leaks.",
    tags: ["debugging"],
    visibility: "private",
    createdBy: marketingMember.id,
    body: "# Debug memory leaks in Node.js\n\nSee debug-guide.md.",
  });
  await db.insert(schema.artifactFiles).values({
    artifactVersionId: skill3Version.id,
    path: "debug-guide.md",
    content: "1. Take a heap snapshot\n2. Compare against a baseline\n3. Look for detached retainers",
    mimeType: "text/markdown",
  });

  // ---- Kits (incl. one nested kit-in-kit, for recursive flatten) --------
  const { artifact: kit1 } = await createArtifact({
    kind: "kit",
    ownerType: "team",
    ownerId: backend.id,
    title: "Code review starter kit",
    description: "Everything needed to review a PR end to end.",
    tags: ["engineering"],
    visibility: "group",
    createdBy: engMember.id,
    body: "Bundles the security review prompt with the PR review checklist skill.",
  });
  await db.insert(schema.artifactMembers).values([
    { kitArtifactId: kit1.id, memberArtifactId: prompt1.id, position: 0 },
    { kitArtifactId: kit1.id, memberArtifactId: skill1.id, position: 1 },
  ]);

  const { artifact: kit2 } = await createArtifact({
    kind: "kit",
    ownerType: "org",
    ownerId: org.id,
    title: "Bộ kit onboarding",
    description: "Các tài liệu và mẫu dùng khi onboarding nhân viên mới.",
    tags: ["hr"],
    visibility: "public",
    createdBy: orgAdmin.id,
    body: "Bộ công cụ onboarding: mẫu email nghỉ phép + hướng dẫn viết test.",
  });
  await db.insert(schema.artifactMembers).values([
    { kitArtifactId: kit2.id, memberArtifactId: prompt3.id, position: 0 },
    { kitArtifactId: kit2.id, memberArtifactId: skill2.id, position: 1 },
  ]);

  // Nested: kit3 contains kit1 (a kit) + prompt2 — exercises recursive
  // flattening (get_kit / flattenKitMembers must resolve kit1's own members).
  const { artifact: kit3 } = await createArtifact({
    kind: "kit",
    ownerType: "user",
    ownerId: engMember.id,
    title: "Meta kit",
    description: "A kit that bundles another kit, to exercise recursive flattening.",
    tags: ["engineering"],
    visibility: "private",
    createdBy: engMember.id,
    body: "Bundles the code review starter kit with the meeting-notes summarizer.",
  });
  await db.insert(schema.artifactMembers).values([
    { kitArtifactId: kit3.id, memberArtifactId: kit1.id, position: 0 },
    { kitArtifactId: kit3.id, memberArtifactId: prompt2.id, position: 1 },
  ]);

  // ---- Plans (tasks covering all 3 statuses) -----------------------------
  const { artifact: plan1 } = await createArtifact({
    kind: "plan",
    ownerType: "team",
    ownerId: backend.id,
    title: "Sửa lỗi phiên đăng nhập hết hạn sớm",
    description: "Phiên hết hạn sau 5 phút thay vì 30 phút như cấu hình.",
    tags: ["bug"],
    visibility: "group",
    createdBy: engMember.id,
    body: "## Tổng quan\n\nSession hết hạn sớm hơn kỳ vọng — cần rà soát cấu hình JWT/cookie.",
  });
  await db.insert(schema.artifactTasks).values([
    { artifactId: plan1.id, position: 0, content: "Tái hiện lỗi ở local", status: "done" },
    { artifactId: plan1.id, position: 1, content: "Xác định root cause trong auth.ts", status: "doing" },
    { artifactId: plan1.id, position: 2, content: "Viết test hồi quy", status: "todo" },
  ]);

  const { artifact: plan2 } = await createArtifact({
    kind: "plan",
    ownerType: "department",
    ownerId: engineering.id,
    title: "Migrate to Next.js 16",
    description: "Upgrade the app router and verify no regressions.",
    tags: ["infra"],
    visibility: "group",
    createdBy: engMember.id,
    body: "## Overview\n\nTrack the upgrade path and verification steps.",
  });
  await db.insert(schema.artifactTasks).values([
    { artifactId: plan2.id, position: 0, content: "Bump next + react versions", status: "done" },
    { artifactId: plan2.id, position: 1, content: "Fix breaking changes in routing", status: "done" },
    { artifactId: plan2.id, position: 2, content: "Full regression pass", status: "doing" },
    { artifactId: plan2.id, position: 3, content: "Update deployment docs", status: "todo" },
  ]);

  const { artifact: plan3 } = await createArtifact({
    kind: "plan",
    ownerType: "org",
    ownerId: org.id,
    title: "Kế hoạch onboarding nhân viên mới",
    description: "Các bước chuẩn bị và theo dõi trong tuần đầu tiên.",
    tags: ["hr"],
    visibility: "public",
    createdBy: orgAdmin.id,
    body: "## Tổng quan\n\nChecklist onboarding cho nhân viên mới trong 2 tuần đầu.",
  });
  await db.insert(schema.artifactTasks).values([
    { artifactId: plan3.id, position: 0, content: "Cấp tài khoản + quyền truy cập", status: "todo" },
    { artifactId: plan3.id, position: 1, content: "Buổi giới thiệu công ty", status: "todo" },
    { artifactId: plan3.id, position: 2, content: "Gán mentor", status: "doing" },
  ]);

  // ---- Docs (linked to their corresponding plan) -------------------------
  const { artifact: doc1 } = await createArtifact({
    kind: "doc",
    ownerType: "team",
    ownerId: backend.id,
    title: "Lỗi: phiên đăng nhập hết hạn sau 5 phút",
    description: "Sessions expire after 5 minutes instead of the configured 30.",
    tags: ["bug"],
    visibility: "group",
    createdBy: engMember.id,
    body: "Người dùng bị đăng xuất sau khoảng 5 phút hoạt động, dù `session.maxAge` được cấu hình là 30 phút.",
  });
  await db.insert(schema.artifactLinks).values({
    sourceArtifactId: plan1.id,
    targetArtifactId: doc1.id,
    relation: "doc",
    createdBy: engMember.id,
  });

  const { artifact: doc2 } = await createArtifact({
    kind: "doc",
    ownerType: "department",
    ownerId: engineering.id,
    title: "Next.js 16 migration notes",
    description: "Breaking changes and gotchas found during the upgrade.",
    tags: ["infra"],
    visibility: "group",
    createdBy: engMember.id,
    body: "Notes on breaking changes encountered while upgrading from Next.js 15 to 16.",
  });
  await db.insert(schema.artifactLinks).values({
    sourceArtifactId: plan2.id,
    targetArtifactId: doc2.id,
    relation: "doc",
    createdBy: engMember.id,
  });

  const { artifact: doc3 } = await createArtifact({
    kind: "doc",
    ownerType: "org",
    ownerId: org.id,
    title: "Quy trình onboarding nhân viên",
    description: "Quy trình chuẩn dành cho quản lý khi có nhân viên mới.",
    tags: ["hr"],
    visibility: "public",
    createdBy: orgAdmin.id,
    body: "Tài liệu mô tả quy trình onboarding chuẩn, dùng kèm với kế hoạch onboarding.",
  });
  await db.insert(schema.artifactLinks).values({
    sourceArtifactId: plan3.id,
    targetArtifactId: doc3.id,
    relation: "doc",
    createdBy: orgAdmin.id,
  });

  // ---- Per-user share (crosses group boundary) ---------------------------
  // prompt2 is private to engMember; share it with marketingMember (viewer)
  // to test that sharing grants access independent of the org hierarchy.
  await db.insert(schema.artifactShares).values({
    artifactId: prompt2.id,
    userId: marketingMember.id,
    role: "viewer",
    grantedBy: engMember.id,
  });

  // ---- Project (Phase 44) — owned by Backend team ------------------------
  // Visibility follows the same D-016 cone as backend's other group
  // artifacts: engMember (direct team editor), orgAdmin/orgViewer (org
  // membership covers descendant team) should all see it; marketingMember
  // (different team) and outsider should not.
  const [project1] = await db
    .insert(schema.projects)
    .values({
      ownerGroupType: "team",
      ownerGroupId: backend.id,
      name: "Session bug fix",
      description: "Docs and plan tracking the early session-expiry bug.",
      createdBy: engMember.id,
    })
    .returning();
  await db.insert(schema.projectArtifacts).values([
    { projectId: project1.id, artifactId: plan1.id },
    { projectId: project1.id, artifactId: doc1.id },
  ]);
  await db.insert(schema.projectMembers).values({
    projectId: project1.id,
    userId: engMember.id,
  });

  // ---- Workflow (Phase 47) — owned by Backend team, linked to project1 ---
  // Same D-016 visibility cone as the project above. Stages cover the same
  // lifecycle idea as the plan: Spec (done) → Build (doing) → Review (todo).
  const [workflow1] = await db
    .insert(schema.workflows)
    .values({
      ownerGroupType: "team",
      ownerGroupId: backend.id,
      projectId: project1.id,
      name: "Session bug fix process",
      description: "Spec, fix, and review process for the session-expiry bug.",
      createdBy: engMember.id,
    })
    .returning();
  const [specStage, buildStage] = await db
    .insert(schema.workflowStages)
    .values([
      { workflowId: workflow1.id, name: "Spec", position: 0, status: "done" },
      { workflowId: workflow1.id, name: "Build", position: 1, status: "doing" },
      { workflowId: workflow1.id, name: "Review", position: 2, status: "todo" },
    ])
    .returning();
  await db.insert(schema.workflowStageArtifacts).values([
    { stageId: specStage.id, artifactId: doc1.id, position: 0 },
    { stageId: buildStage.id, artifactId: kit1.id, position: 0 },
    { stageId: buildStage.id, artifactId: skill1.id, position: 1 },
    { stageId: buildStage.id, artifactId: plan1.id, position: 2 },
  ]);

  console.log("Seeded:");
  console.log(`  users: superadmin, org-admin, org-viewer, eng-member, marketing-member, outsider (password: ${PASSWORD})`);
  console.log(`  org "${org.slug}" → dept [engineering, marketing] → team [backend, content]`);
  console.log("  15 artifacts (3 per kind: prompt, skill, kit, plan, doc), 1 cross-team share, 1 nested kit");
  console.log("  1 project (Backend team) with 1 plan + 1 doc assigned, 1 member (eng-member)");
  console.log("  1 workflow (Backend team, linked to the project) with 3 stages (Spec done, Build doing, Review todo)");
}

main()
  .then(() => {
    console.log("Done.");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
