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
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/* -------------------------------------------------------------------------- */
/* Enums                                                                       */
/* -------------------------------------------------------------------------- */

/** Level of a group in the org → department → team hierarchy. */
export const groupTypeEnum = pgEnum("group_type", ["org", "department", "team"]);

/** Member role within a group (kept simple for MVP). */
export const roleEnum = pgEnum("role", ["viewer", "editor", "admin"]);

/** Who owns a prompt: a single user or any group at any level. */
export const ownerTypeEnum = pgEnum("owner_type", [
  "user",
  "org",
  "department",
  "team",
]);

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

export const prompts = pgTable(
  "prompts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Polymorphic owner: user / org / department / team. `ownerId` has no FK. */
    ownerType: ownerTypeEnum("owner_type").notNull(),
    ownerId: uuid("owner_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    tags: text("tags").array().notNull().default([]),
    visibility: visibilityEnum("visibility").notNull().default("private"),
    /** Points to the current version. Rollback = update this pointer. */
    currentVersionId: uuid("current_version_id").references(
      (): import("drizzle-orm/pg-core").AnyPgColumn => promptVersions.id,
      { onDelete: "set null" }
    ),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("prompts_owner_idx").on(t.ownerType, t.ownerId),
    index("prompts_visibility_idx").on(t.visibility),
  ]
);

/** Each save creates a new immutable version. */
export const promptVersions = pgTable(
  "prompt_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    body: text("body").notNull(),
    changelog: text("changelog"),
    /** Optional model/temperature hints stored as JSON. */
    modelHints: jsonb("model_hints"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("prompt_versions_prompt_version_uq").on(t.promptId, t.versionNo),
    index("prompt_versions_prompt_idx").on(t.promptId),
  ]
);

export const promptVariables = pgTable(
  "prompt_variables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull().default("string"),
    defaultValue: text("default_value"),
    required: boolean("required").notNull().default(false),
  },
  (t) => [unique("prompt_variables_prompt_name_uq").on(t.promptId, t.name)]
);

/**
 * Embeddings for semantic search (v0.2).
 * `embedderId` + `dimensions` are stored alongside the vector so we know which model
 * produced it when switching providers.
 * NOTE: pgvector requires a fixed dimension per column + HNSW index. Defaults to 1024 (bge-m3).
 * Switching to a model with different dimensions requires a new column or migration.
 */
export const promptEmbeddings = pgTable(
  "prompt_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promptVersionId: uuid("prompt_version_id")
      .notNull()
      .references(() => promptVersions.id, { onDelete: "cascade" }),
    embedderId: text("embedder_id").notNull(),
    dimensions: integer("dimensions").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("prompt_embeddings_version_idx").on(t.promptVersionId),
    index("prompt_embeddings_hnsw_idx")
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

export const promptsRelations = relations(prompts, ({ many }) => ({
  versions: many(promptVersions),
  variables: many(promptVariables),
}));

export const promptVersionsRelations = relations(promptVersions, ({ one }) => ({
  prompt: one(prompts, {
    fields: [promptVersions.promptId],
    references: [prompts.id],
  }),
}));

export const promptVariablesRelations = relations(promptVariables, ({ one }) => ({
  prompt: one(prompts, {
    fields: [promptVariables.promptId],
    references: [prompts.id],
  }),
}));
