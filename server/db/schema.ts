import {
  pgTable,
  pgEnum,
  text,
  uuid,
  integer,
  boolean,
  date,
  timestamp,
  jsonb,
  vector,
  primaryKey,
  unique,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

/* -------------------------------------------------------------------------- */
/* Enums                                                                       */
/* -------------------------------------------------------------------------- */

/** Level of a group in the org → department → team hierarchy. */
export const groupTypeEnum = pgEnum("group_type", ["org", "department", "team"]);

/** Member role within a group (kept simple for MVP). */
export const roleEnum = pgEnum("role", ["viewer", "editor", "admin"]);

/** Platform-level role: superadmin bypasses all org/group access checks. */
export const systemRoleEnum = pgEnum("system_role", ["user", "superadmin"]);

/** Who owns a prompt: a single user or any group at any level. */
export const ownerTypeEnum = pgEnum("owner_type", [
  "user",
  "org",
  "department",
  "team",
]);

/** Status of a plan task. */
export const taskStatusEnum = pgEnum("task_status", ["todo", "doing", "done"]);

/** Share role for per-user artifact sharing. */
export const shareRoleEnum = pgEnum("share_role", ["viewer", "editor"]);
export type ShareRole = "viewer" | "editor";
export type TaskStatus = "todo" | "doing" | "done";

/** Role within a doc/plan assignment: one assigner, many assignees (Phase 53). */
export const assignmentRoleEnum = pgEnum("assignment_role", ["assigner", "assignee"]);
export type AssignmentRole = "assigner" | "assignee";

/** Workflow state for a Doc/Plan assignment as a whole (not individual Plan tasks). */
export const assignmentStatusEnum = pgEnum("assignment_status", ["open", "in_progress", "blocked", "done"]);
export type AssignmentStatus = "open" | "in_progress" | "blocked" | "done";

/** Coordination priority for a Doc/Plan work item. */
export const assignmentPriorityEnum = pgEnum("assignment_priority", ["low", "normal", "high", "urgent"]);
export type AssignmentPriority = "low" | "normal" | "high" | "urgent";

/** What triggered an in-app notification (Phase 53 generalizes beyond version bumps). */
export const notificationTypeEnum = pgEnum("notification_type", ["version", "assignment"]);
export type NotificationType = "version" | "assignment";

/** Visibility scope of a prompt. */
export const visibilityEnum = pgEnum("visibility", [
  "private", // owner only (user)
  "group",   // members of the owning group (access inherits upward — option A)
  "public",  // everyone
]);

/* -------------------------------------------------------------------------- */
/* Auth (compatible with @auth/drizzle-adapter) + basic auth                  */
/* -------------------------------------------------------------------------- */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  /** Password hash for basic auth (Credentials). Null when user only has OAuth. */
  passwordHash: text("password_hash"),
  /** Platform-level role. superadmin bypasses all org/group access checks. */
  systemRole: systemRoleEnum("system_role").notNull().default("user"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** OAuth accounts (Auth.js adapter shape). */
export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refreshToken: text("refresh_token"),
    accessToken: text("access_token"),
    expiresAt: integer("expires_at"),
    tokenType: text("token_type"),
    scope: text("scope"),
    idToken: text("id_token"),
    sessionState: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })]
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })]
);

/* -------------------------------------------------------------------------- */
/* Organization: org → department → team                                       */
/* -------------------------------------------------------------------------- */

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug"),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("departments_org_id_idx").on(t.orgId),
    unique("departments_org_slug_uq").on(t.orgId, t.slug),
  ]
);

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug"),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("teams_department_id_idx").on(t.departmentId),
    unique("teams_department_slug_uq").on(t.departmentId, t.slug),
  ]
);

/**
 * Memberships are stored at the lowest level the user directly belongs to.
 * Access to parent groups (department, org) is derived via the hierarchy (option A — inherit upward):
 * team member ⇒ implicitly belongs to parent department + org.
 * `groupId` is polymorphic (points to orgs/departments/teams depending on groupType) — no FK.
 */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    groupType: groupTypeEnum("group_type").notNull(),
    groupId: uuid("group_id").notNull(),
    role: roleEnum("role").notNull().default("editor"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("memberships_user_group_uq").on(t.userId, t.groupType, t.groupId),
    index("memberships_group_idx").on(t.groupType, t.groupId),
    index("memberships_user_idx").on(t.userId),
  ]
);

/* -------------------------------------------------------------------------- */
/* Prompts                                                                     */
/* -------------------------------------------------------------------------- */

/** Discriminates the kind of artifact. prompt (default) ⊂ skill ⊂ kit ⊂ plan. */
export const artifactKindEnum = ["prompt", "skill", "kit", "plan", "doc"] as const;
export type ArtifactKind = (typeof artifactKindEnum)[number];

/**
 * An artifact is a reusable agent capability. Three kinds share this table:
 * - prompt: a single template (body = the prompt text, with {{vars}}).
 * - skill: instructions (body = SKILL.md) + bundled files (artifact_files).
 * - kit: a curated bundle referencing other artifacts (artifact_members).
 * Versioning, variables, embeddings, permissions and search are shared across kinds.
 */
export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** prompt | skill | kit. Stored as text + CHECK at migration level. */
    kind: text("kind").notNull().default("prompt").$type<ArtifactKind>(),
    /** Polymorphic owner: user / org / department / team. `ownerId` has no FK. */
    ownerType: ownerTypeEnum("owner_type").notNull(),
    ownerId: uuid("owner_id").notNull(),
    title: text("title").notNull(),
    /** Optional stable slug for the MCP slash command name. Unique per owner. */
    slug: text("slug"),
    description: text("description"),
    tags: text("tags").array().notNull().default([]),
    visibility: visibilityEnum("visibility").notNull().default("private"),
    /** Points to the current version. Rollback = update this pointer. */
    currentVersionId: uuid("current_version_id").references(
      (): import("drizzle-orm/pg-core").AnyPgColumn => artifactVersions.id,
      { onDelete: "set null" }
    ),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Usage analytics (Phase 41): bumped fire-and-forget whenever an agent
     * actually pulls this artifact's content over MCP (prompt invoked,
     * get_skill/get_kit/get_plan/get_doc) — not on search results or list
     * views, which only surface a candidate, not a use.
     */
    fetchCount: integer("fetch_count").notNull().default(0),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  },
  (t) => [
    index("artifacts_owner_idx").on(t.ownerType, t.ownerId),
    index("artifacts_visibility_idx").on(t.visibility),
    // Full-text search over title + description. Must be declared here (not
    // just in a raw-SQL migration) so `drizzle-kit push`-built databases get
    // it too — otherwise search falls back to a per-row seq scan (D-019).
    // The tsvector expression must match runTs()/runFts() in lib/search.ts
    // exactly for the planner to use this index.
    index("artifacts_fts_idx").using(
      "gin",
      sql`to_tsvector('english', ${t.title} || ' ' || coalesce(${t.description}, ''))`,
    ),
    // Slug is unique per owner scope, but NULL slugs are unlimited. Same
    // schema-vs-migration divergence as the FTS index (D-019): without this
    // in schema.ts, push-built DBs have no DB-level guard against duplicate
    // slugs — checkSlug in the router is only a TOCTOU check, not a guarantee.
    uniqueIndex("artifacts_owner_slug_uniq")
      .on(t.ownerType, t.ownerId, t.slug)
      .where(sql`${t.slug} IS NOT NULL`),
  ]
);

/** Each save creates a new immutable version. */
export const artifactVersions = pgTable(
  "artifact_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    body: text("body").notNull(),
    changelog: text("changelog"),
    /** Optional model/temperature hints stored as JSON. */
    modelHints: jsonb("model_hints"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("artifact_versions_artifact_version_uq").on(t.artifactId, t.versionNo),
    index("artifact_versions_artifact_idx").on(t.artifactId),
  ]
);

export const artifactVariables = pgTable(
  "artifact_variables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull().default("string"),
    defaultValue: text("default_value"),
    required: boolean("required").notNull().default(false),
  },
  (t) => [unique("artifact_variables_artifact_name_uq").on(t.artifactId, t.name)]
);

/**
 * Files bundled with a skill artifact (scripts, references, templates), versioned
 * together with the skill via `artifactVersionId`. Empty for prompt/kit kinds.
 */
export const artifactFiles = pgTable(
  "artifact_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactVersionId: uuid("artifact_version_id")
      .notNull()
      .references(() => artifactVersions.id, { onDelete: "cascade" }),
    /** Relative path inside the skill folder, e.g. "scripts/run.py". */
    path: text("path").notNull(),
    content: text("content").notNull(),
    mimeType: text("mime_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("artifact_files_version_path_uq").on(t.artifactVersionId, t.path),
    index("artifact_files_version_idx").on(t.artifactVersionId),
  ]
);

/**
 * Members of a kit artifact: an ordered list of other artifacts (prompts/skills).
 * References the latest version of each member (live, no copy). Empty for prompt/skill.
 */
export const artifactMembers = pgTable(
  "artifact_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kitArtifactId: uuid("kit_artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    memberArtifactId: uuid("member_artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("artifact_members_kit_member_uq").on(t.kitArtifactId, t.memberArtifactId),
    index("artifact_members_kit_idx").on(t.kitArtifactId),
  ]
);

/**
 * Tasks belonging to a plan artifact (live, not versioned).
 * Tick status without creating a new version. Overview body is versioned separately.
 */
export const artifactTasks = pgTable(
  "artifact_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    content: text("content").notNull(),
    status: taskStatusEnum("status").notNull().default("todo"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("artifact_tasks_artifact_idx").on(t.artifactId)]
);

/**
 * Per-user artifact sharing. One row per (artifact, grantee) pair.
 * Viewer = read; Editor = read + mutate. Only owner/admin can share.
 */
export const artifactShares = pgTable(
  "artifact_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: shareRoleEnum("role").notNull(),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("artifact_shares_artifact_user_uq").on(t.artifactId, t.userId),
    index("artifact_shares_user_idx").on(t.userId),
    index("artifact_shares_artifact_idx").on(t.artifactId),
  ]
);

/**
 * Assigner/assignee for a doc or plan (Phase 53) — mirrors `artifactShares`'
 * shape (one table, `role` discriminates). Assignee is many-per-artifact;
 * assigner is at most one (enforced by the partial unique index below) and is
 * an override — when absent, the *effective* assigner is resolved at read
 * time (owner-user, else `createdBy` for group-owned artifacts; see
 * `resolveAssigner()` in server/services/assignment.ts) rather than
 * backfilled here, so existing docs/plans need no migration.
 */
export const artifactAssignments = pgTable(
  "artifact_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: assignmentRoleEnum("role").notNull(),
    assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("artifact_assignments_artifact_user_role_uq").on(t.artifactId, t.userId, t.role),
    uniqueIndex("artifact_assignments_one_assigner_uniq")
      .on(t.artifactId)
      .where(sql`${t.role} = 'assigner'`),
    index("artifact_assignments_user_idx").on(t.userId),
    index("artifact_assignments_artifact_idx").on(t.artifactId),
  ]
);

/**
 * Work metadata for an assigned Doc/Plan. The row is optional: absence means
 * status=open, priority=normal, dueDate=null. This keeps existing artifacts
 * migration-free and creates state lazily on the first real change.
 */
export const artifactWorkItems = pgTable(
  "artifact_work_items",
  {
    artifactId: uuid("artifact_id")
      .primaryKey()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    status: assignmentStatusEnum("status").notNull().default("open"),
    priority: assignmentPriorityEnum("priority").notNull().default("normal"),
    dueDate: date("due_date"),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("artifact_work_items_status_due_idx").on(t.status, t.dueDate),
    index("artifact_work_items_priority_due_idx").on(t.priority, t.dueDate),
  ],
);

/**
 * In-app notification. `type` discriminates the trigger: 'version' (an
 * artifact shared with `userId` per `artifactShares` got a new version —
 * `artifactVersionId` set, the original Phase 41 shape) or 'assignment'
 * (Phase 53 — assigner/assignee changed; `artifactVersionId` null,
 * `metadata` carries the event). One row per (recipient, event) —
 * append-only, only `isRead` ever changes.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull().default("version"),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    artifactVersionId: uuid("artifact_version_id").references(() => artifactVersions.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    metadata: jsonb("metadata"),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId),
    index("notifications_user_unread_idx").on(t.userId, t.isRead),
  ]
);

/** Per-user "starred" artifacts (Phase 43 M3.3) — one row per (user, artifact), toggled on/off. */
export const artifactFavorites = pgTable(
  "artifact_favorites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("artifact_favorites_user_artifact_uq").on(t.userId, t.artifactId),
    index("artifact_favorites_user_idx").on(t.userId),
  ]
);

/**
 * Generic directed link between two artifacts (e.g. plan → doc).
 * `relation` is free-form text (default 'doc'). Unique per (source, target, relation).
 * Cascade-deletes when either artifact is removed.
 */
export const artifactLinks = pgTable(
  "artifact_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceArtifactId: uuid("source_artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    targetArtifactId: uuid("target_artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    /** Relation type — 'doc' for plan→doc; extensible. */
    relation: text("relation").notNull().default("doc"),
    position: integer("position").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("artifact_links_source_target_relation_uq").on(
      t.sourceArtifactId,
      t.targetArtifactId,
      t.relation,
    ),
    index("artifact_links_source_idx").on(t.sourceArtifactId),
    index("artifact_links_target_idx").on(t.targetArtifactId),
  ]
);

/**
 * Embeddings for semantic search (v0.2).
 * `embedderId` + `dimensions` are stored alongside the vector so we know which model
 * produced it when switching providers.
 * NOTE: pgvector requires a fixed dimension per column + HNSW index. Defaults to 1024 (bge-m3).
 * Switching to a model with different dimensions requires a new column or migration.
 */
export const artifactEmbeddings = pgTable(
  "artifact_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactVersionId: uuid("artifact_version_id")
      .notNull()
      .references(() => artifactVersions.id, { onDelete: "cascade" }),
    embedderId: text("embedder_id").notNull(),
    dimensions: integer("dimensions").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("artifact_embeddings_version_idx").on(t.artifactVersionId),
    index("artifact_embeddings_hnsw_idx")
      .using("hnsw", t.embedding.op("vector_cosine_ops")),
  ]
);

/* -------------------------------------------------------------------------- */
/* Audit log (Phase 46) — security-relevant mutations                          */
/* -------------------------------------------------------------------------- */

/**
 * Append-only audit trail for destructive + permission-changing events —
 * deletes, shares, membership/role changes, token issuance/revocation. It
 * deliberately does NOT log ordinary create/update of artifact content: that
 * is already traceable via artifact_versions (each carries createdBy), so
 * audit_events covers only what version history can't. `targetId` is
 * polymorphic (no FK) — the target may have been deleted, which is often
 * exactly the event being recorded.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Who did it. Null if the actor's user row was later deleted. */
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    /** Dotted action key, e.g. "artifact.delete", "share.grant", "membership.role". */
    action: text("action").notNull(),
    /** Primary entity acted on, e.g. "artifact" | "org" | "team" | "user" | "token" | "project". */
    targetType: text("target_type").notNull(),
    /** Id of that entity (polymorphic, no FK). Null for actions without a single target. */
    targetId: uuid("target_id"),
    /** Extra context: role old→new, grantee, group, title snapshot, etc. */
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_events_target_idx").on(t.targetType, t.targetId),
    index("audit_events_actor_idx").on(t.actorId),
    index("audit_events_created_idx").on(t.createdAt),
  ]
);

/* -------------------------------------------------------------------------- */
/* Projects (Phase 44) — organizational grouping of doc/plan artifacts        */
/* -------------------------------------------------------------------------- */

/**
 * A project is a purely organizational grouping of doc/plan artifacts, owned
 * by a group (org/dept/team). It does NOT grant any access — visibility of a
 * project follows `getAccessibleGroups` (D-016 cone) on its owner group, and
 * management follows `effectiveGroupRole` on that same group, exactly like
 * group-owned artifacts. `ownerGroupId` is polymorphic (no FK), same pattern
 * as `memberships.groupId`.
 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerGroupType: groupTypeEnum("owner_group_type").notNull(),
    ownerGroupId: uuid("owner_group_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("projects_owner_idx").on(t.ownerGroupType, t.ownerGroupId)]
);

/**
 * Many-to-many: a doc/plan artifact can belong to multiple projects.
 * Kind restriction (doc|plan only) is enforced at the router level, not here
 * (matches the codebase convention of kind-checking in routers).
 */
export const projectArtifacts = pgTable(
  "project_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("project_artifacts_project_artifact_uq").on(t.projectId, t.artifactId),
    index("project_artifacts_artifact_idx").on(t.artifactId),
  ]
);

/**
 * Flat (no-role) member list of a project. Organizational only — membership
 * itself grants no permissions; manage-rights come from the owning group's
 * `effectiveGroupRole`. Used to power "My projects" surfaces.
 */
export const projectMembers = pgTable(
  "project_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("project_members_project_user_uq").on(t.projectId, t.userId),
    index("project_members_user_idx").on(t.userId),
  ]
);

/* -------------------------------------------------------------------------- */
/* Workflows (Phase 47) — named process of ordered stages over the lifecycle  */
/* -------------------------------------------------------------------------- */

/**
 * A workflow is a named process made of ordered stages (e.g. Spec → Build →
 * Review), owned by a group — same access model as projects, zero new
 * access-control code (D-016 cone for view, effectiveGroupRole for manage).
 * Optionally linked to a project (`projectId` nullable) — a workflow can be
 * a standalone recurring process (e.g. "bug triage") or scoped to one project.
 */
export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerGroupType: groupTypeEnum("owner_group_type").notNull(),
    ownerGroupId: uuid("owner_group_id").notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("workflows_owner_idx").on(t.ownerGroupType, t.ownerGroupId),
    index("workflows_project_idx").on(t.projectId),
  ]
);

/**
 * An ordered stage within a workflow. Status reuses task_status (todo/doing/
 * done) — same vocabulary as plan tasks, no new enum. Multiple stages may be
 * "doing" at once (not a strict linear gate) — the UI just highlights the
 * first one still in progress.
 */
export const workflowStages = pgTable(
  "workflow_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    status: taskStatusEnum("status").notNull().default("todo"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("workflow_stages_workflow_idx").on(t.workflowId)]
);

/**
 * Many-to-many: any artifact kind can attach to a stage (unlike
 * project_artifacts, which is doc|plan-only) — this is where kit/skill/prompt
 * participate in the process, alongside doc (spec) and plan (execution).
 */
export const workflowStageArtifacts = pgTable(
  "workflow_stage_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => workflowStages.id, { onDelete: "cascade" }),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("workflow_stage_artifacts_stage_artifact_uq").on(t.stageId, t.artifactId),
    index("workflow_stage_artifacts_artifact_idx").on(t.artifactId),
  ]
);

/* -------------------------------------------------------------------------- */
/* MCP tokens                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Tokens generated by users on the UI for agent MCP access.
 * Only the hash is stored; `tokenPrefix` is used for display / identification.
 * Invariant: access(token) = access(user) ∩ scope(token).
 */
export const mcpTokens = pgTable(
  "mcp_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    tokenPrefix: text("token_prefix").notNull(),
    /** Scope definition: which prompts this token may access (by owner, tag, etc.). */
    scope: jsonb("scope"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mcp_tokens_user_idx").on(t.userId)]
);

/* -------------------------------------------------------------------------- */
/* Relations                                                                   */
/* -------------------------------------------------------------------------- */

export const orgsRelations = relations(orgs, ({ many }) => ({
  departments: many(departments),
}));

export const departmentsRelations = relations(departments, ({ one, many }) => ({
  org: one(orgs, { fields: [departments.orgId], references: [orgs.id] }),
  teams: many(teams),
}));

export const teamsRelations = relations(teams, ({ one }) => ({
  department: one(departments, {
    fields: [teams.departmentId],
    references: [departments.id],
  }),
}));

export const artifactsRelations = relations(artifacts, ({ one, many }) => ({
  versions: many(artifactVersions),
  variables: many(artifactVariables),
  members: many(artifactMembers, { relationName: "kit" }),
  tasks: many(artifactTasks),
  shares: many(artifactShares),
  workItem: one(artifactWorkItems),
  outgoingLinks: many(artifactLinks, { relationName: "source" }),
  incomingLinks: many(artifactLinks, { relationName: "target" }),
}));

export const artifactVersionsRelations = relations(artifactVersions, ({ one, many }) => ({
  artifact: one(artifacts, {
    fields: [artifactVersions.artifactId],
    references: [artifacts.id],
  }),
  files: many(artifactFiles),
}));

export const artifactVariablesRelations = relations(artifactVariables, ({ one }) => ({
  artifact: one(artifacts, {
    fields: [artifactVariables.artifactId],
    references: [artifacts.id],
  }),
}));

export const artifactFilesRelations = relations(artifactFiles, ({ one }) => ({
  version: one(artifactVersions, {
    fields: [artifactFiles.artifactVersionId],
    references: [artifactVersions.id],
  }),
}));

export const artifactMembersRelations = relations(artifactMembers, ({ one }) => ({
  kit: one(artifacts, {
    relationName: "kit",
    fields: [artifactMembers.kitArtifactId],
    references: [artifacts.id],
  }),
  member: one(artifacts, {
    fields: [artifactMembers.memberArtifactId],
    references: [artifacts.id],
  }),
}));

export const artifactTasksRelations = relations(artifactTasks, ({ one }) => ({
  artifact: one(artifacts, {
    fields: [artifactTasks.artifactId],
    references: [artifacts.id],
  }),
}));

export const artifactSharesRelations = relations(artifactShares, ({ one }) => ({
  artifact: one(artifacts, {
    fields: [artifactShares.artifactId],
    references: [artifacts.id],
  }),
  user: one(users, {
    relationName: "shareGrantee",
    fields: [artifactShares.userId],
    references: [users.id],
  }),
  grantedByUser: one(users, {
    relationName: "shareGrantor",
    fields: [artifactShares.grantedBy],
    references: [users.id],
  }),
}));

export const artifactAssignmentsRelations = relations(artifactAssignments, ({ one }) => ({
  artifact: one(artifacts, {
    fields: [artifactAssignments.artifactId],
    references: [artifacts.id],
  }),
  user: one(users, {
    relationName: "assignmentUser",
    fields: [artifactAssignments.userId],
    references: [users.id],
  }),
  assignedByUser: one(users, {
    relationName: "assignmentAssignedBy",
    fields: [artifactAssignments.assignedBy],
    references: [users.id],
  }),
}));

export const artifactWorkItemsRelations = relations(artifactWorkItems, ({ one }) => ({
  artifact: one(artifacts, {
    fields: [artifactWorkItems.artifactId],
    references: [artifacts.id],
  }),
  updatedByUser: one(users, {
    relationName: "workItemUpdatedBy",
    fields: [artifactWorkItems.updatedBy],
    references: [users.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    relationName: "notificationRecipient",
    fields: [notifications.userId],
    references: [users.id],
  }),
  actor: one(users, {
    relationName: "notificationActor",
    fields: [notifications.actorId],
    references: [users.id],
  }),
  artifact: one(artifacts, {
    fields: [notifications.artifactId],
    references: [artifacts.id],
  }),
  artifactVersion: one(artifactVersions, {
    fields: [notifications.artifactVersionId],
    references: [artifactVersions.id],
  }),
}));

export const artifactFavoritesRelations = relations(artifactFavorites, ({ one }) => ({
  user: one(users, {
    fields: [artifactFavorites.userId],
    references: [users.id],
  }),
  artifact: one(artifacts, {
    fields: [artifactFavorites.artifactId],
    references: [artifacts.id],
  }),
}));

export const artifactLinksRelations = relations(artifactLinks, ({ one }) => ({
  source: one(artifacts, {
    relationName: "source",
    fields: [artifactLinks.sourceArtifactId],
    references: [artifacts.id],
  }),
  target: one(artifacts, {
    relationName: "target",
    fields: [artifactLinks.targetArtifactId],
    references: [artifacts.id],
  }),
}));

export const projectsRelations = relations(projects, ({ many }) => ({
  artifacts: many(projectArtifacts),
  workflows: many(workflows),
  members: many(projectMembers),
}));

export const projectArtifactsRelations = relations(projectArtifacts, ({ one }) => ({
  project: one(projects, {
    fields: [projectArtifacts.projectId],
    references: [projects.id],
  }),
  artifact: one(artifacts, {
    fields: [projectArtifacts.artifactId],
    references: [artifacts.id],
  }),
}));

export const workflowsRelations = relations(workflows, ({ one, many }) => ({
  project: one(projects, {
    fields: [workflows.projectId],
    references: [projects.id],
  }),
  stages: many(workflowStages),
}));

export const workflowStagesRelations = relations(workflowStages, ({ one, many }) => ({
  workflow: one(workflows, {
    fields: [workflowStages.workflowId],
    references: [workflows.id],
  }),
  artifacts: many(workflowStageArtifacts),
}));

export const workflowStageArtifactsRelations = relations(workflowStageArtifacts, ({ one }) => ({
  stage: one(workflowStages, {
    fields: [workflowStageArtifacts.stageId],
    references: [workflowStages.id],
  }),
  artifact: one(artifacts, {
    fields: [workflowStageArtifacts.artifactId],
    references: [artifacts.id],
  }),
}));

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, {
    fields: [projectMembers.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [projectMembers.userId],
    references: [users.id],
  }),
}));

export const auditEventsRelations = relations(auditEvents, ({ one }) => ({
  actor: one(users, {
    fields: [auditEvents.actorId],
    references: [users.id],
  }),
}));
