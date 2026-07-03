import {
  pgTable,
  pgEnum,
  text,
  uuid,
  integer,
  boolean,
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

export const artifactsRelations = relations(artifacts, ({ many }) => ({
  versions: many(artifactVersions),
  variables: many(artifactVariables),
  members: many(artifactMembers, { relationName: "kit" }),
  tasks: many(artifactTasks),
  shares: many(artifactShares),
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
