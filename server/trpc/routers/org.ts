import { z } from "zod";
import { eq, and, inArray, count } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { orgs, departments, teams, memberships, users, artifacts } from "@/server/db/schema";
import { TRPCError } from "@trpc/server";
import type { DbClient } from "@/server/db/types";
import { resolveOwnerSlugPaths } from "@/server/lib/owner-path";
import { effectiveGroupRole } from "@/server/auth/access";

const slugSchema = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens");

// ── Helpers ──────────────────────────────────────────────────────────────────

async function requireOrgRole(
  db: DbClient,
  userId: string,
  orgId: string,
  minRole: "viewer" | "editor" | "admin" = "viewer",
  systemRole: "user" | "superadmin" = "user",
) {
  if (systemRole === "superadmin") return;
  const ROLES = ["viewer", "editor", "admin"];
  const m = await db.query.memberships.findFirst({
    where: and(
      eq(memberships.userId, userId),
      eq(memberships.groupType, "org"),
      eq(memberships.groupId, orgId),
    ),
  });
  if (!m || ROLES.indexOf(m.role) < ROLES.indexOf(minRole)) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return m;
}

export async function resolveOwningOrgId(
  db: DbClient,
  groupType: "org" | "department" | "team",
  groupId: string,
): Promise<string> {
  if (groupType === "org") return groupId;
  if (groupType === "department") {
    const dept = await db.query.departments.findFirst({ where: eq(departments.id, groupId) });
    if (!dept) throw new TRPCError({ code: "NOT_FOUND" });
    return dept.orgId;
  }
  const team = await db.query.teams.findFirst({ where: eq(teams.id, groupId) });
  if (!team) throw new TRPCError({ code: "NOT_FOUND" });
  const dept = await db.query.departments.findFirst({
    where: eq(departments.id, team.departmentId),
  });
  if (!dept) throw new TRPCError({ code: "NOT_FOUND" });
  return dept.orgId;
}

function requireSuperAdmin(systemRole: "user" | "superadmin"): void {
  if (systemRole !== "superadmin") throw new TRPCError({ code: "FORBIDDEN" });
}

async function requireGroupAdmin(
  db: DbClient,
  userId: string,
  groupType: "org" | "department" | "team",
  groupId: string,
  systemRole: "user" | "superadmin",
): Promise<void> {
  if (systemRole === "superadmin") return;
  const role = await effectiveGroupRole(userId, groupType, groupId, db);
  if (role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
}

async function ensureNotLastOrgAdmin(db: DbClient, membershipId: string): Promise<void> {
  const m = await db.query.memberships.findFirst({ where: eq(memberships.id, membershipId) });
  if (!m || m.groupType !== "org" || m.role !== "admin") return;

  const [{ adminCount }] = await db
    .select({ adminCount: count() })
    .from(memberships)
    .where(
      and(
        eq(memberships.groupType, "org"),
        eq(memberships.groupId, m.groupId),
        eq(memberships.role, "admin"),
      ),
    );

  if (adminCount <= 1) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot remove the last admin of an organization",
    });
  }
}

// ── Org router ────────────────────────────────────────────────────────────────

export const orgRouter = router({
  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100), slug: slugSchema }))
    .mutation(async ({ ctx, input }) => {
      requireSuperAdmin(ctx.session.systemRole);
      const [org] = await ctx.db
        .insert(orgs)
        .values({ name: input.name, slug: input.slug })
        .returning();
      await ctx.db.insert(memberships).values({
        userId: ctx.session.userId,
        groupType: "org",
        groupId: org.id,
        role: "admin",
      });
      return org;
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ org: orgs })
      .from(orgs)
      .innerJoin(
        memberships,
        and(
          eq(memberships.groupId, orgs.id),
          eq(memberships.groupType, "org"),
          eq(memberships.userId, ctx.session.userId),
        ),
      );
    return rows.map((r) => r.org);
  }),

  /**
   * All spaces (orgs/depts/teams) the current user directly belongs to,
   * with their pre-resolved hierarchical slug paths.
   */
  mySpaces: protectedProcedure.query(async ({ ctx }) => {
    const { userId } = ctx.session;

    const mships = await ctx.db.query.memberships.findMany({
      where: eq(memberships.userId, userId),
      columns: { groupType: true, groupId: true, role: true },
    });
    if (!mships.length) return [];

    const orgIds = mships.filter((m) => m.groupType === "org").map((m) => m.groupId);
    const deptIds = mships.filter((m) => m.groupType === "department").map((m) => m.groupId);
    const teamIds = mships.filter((m) => m.groupType === "team").map((m) => m.groupId);

    const [orgRows, deptRows, teamRows] = await Promise.all([
      orgIds.length
        ? ctx.db.select({ id: orgs.id, name: orgs.name }).from(orgs).where(inArray(orgs.id, orgIds))
        : [],
      deptIds.length
        ? ctx.db
            .select({ id: departments.id, name: departments.name })
            .from(departments)
            .where(inArray(departments.id, deptIds))
        : [],
      teamIds.length
        ? ctx.db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, teamIds))
        : [],
    ]);

    const nameMap = new Map<string, string>();
    for (const r of [...orgRows, ...deptRows, ...teamRows]) nameMap.set(r.id, r.name);

    const slugPaths = await resolveOwnerSlugPaths(
      mships.map((m) => ({ ownerType: m.groupType, ownerId: m.groupId })),
      ctx.db,
    );

    return mships.map((m) => ({
      type: m.groupType as "org" | "department" | "team",
      id: m.groupId,
      name: nameMap.get(m.groupId) ?? m.groupId,
      slugPath: slugPaths.get(`${m.groupType}:${m.groupId}`) ?? "",
      role: m.role,
    }));
  }),

  delete: protectedProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireSuperAdmin(ctx.session.systemRole);

      const org = await ctx.db.query.orgs.findFirst({ where: eq(orgs.id, input.orgId) });
      if (!org) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.db.transaction(async (tx) => {
        const deptRows = await tx
          .select({ id: departments.id })
          .from(departments)
          .where(eq(departments.orgId, input.orgId));
        const deptIds = deptRows.map((d) => d.id);

        const teamRows =
          deptIds.length > 0
            ? await tx
                .select({ id: teams.id })
                .from(teams)
                .where(inArray(teams.departmentId, deptIds))
            : [];
        const teamIds = teamRows.map((t) => t.id);

        // Delete artifacts (polymorphic — no FK)
        await tx.delete(artifacts).where(
          and(eq(artifacts.ownerType, "org"), eq(artifacts.ownerId, input.orgId)),
        );
        if (deptIds.length > 0) {
          await tx.delete(artifacts).where(
            and(eq(artifacts.ownerType, "department"), inArray(artifacts.ownerId, deptIds)),
          );
        }
        if (teamIds.length > 0) {
          await tx.delete(artifacts).where(
            and(eq(artifacts.ownerType, "team"), inArray(artifacts.ownerId, teamIds)),
          );
        }

        // Delete memberships (polymorphic — no FK)
        await tx.delete(memberships).where(
          and(eq(memberships.groupType, "org"), eq(memberships.groupId, input.orgId)),
        );
        if (deptIds.length > 0) {
          await tx.delete(memberships).where(
            and(eq(memberships.groupType, "department"), inArray(memberships.groupId, deptIds)),
          );
        }
        if (teamIds.length > 0) {
          await tx.delete(memberships).where(
            and(eq(memberships.groupType, "team"), inArray(memberships.groupId, teamIds)),
          );
        }

        // Delete org — departments + teams cascade via FK
        await tx.delete(orgs).where(eq(orgs.id, input.orgId));
      });
    }),

  setGroupImage: protectedProcedure
    .input(
      z.object({
        groupType: z.enum(["org", "department", "team"]),
        groupId: z.string().uuid(),
        image: z.string().url().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, systemRole } = ctx.session;
      const orgId = await resolveOwningOrgId(ctx.db, input.groupType, input.groupId);
      await requireOrgRole(ctx.db, userId, orgId, "admin", systemRole);

      if (input.image !== null) {
        const { validateAvatarUrl } = await import("@/server/lib/avatar");
        await validateAvatarUrl(input.image);
      }

      if (input.groupType === "org") {
        await ctx.db.update(orgs).set({ image: input.image }).where(eq(orgs.id, input.groupId));
      } else if (input.groupType === "department") {
        await ctx.db.update(departments).set({ image: input.image }).where(eq(departments.id, input.groupId));
      } else {
        await ctx.db.update(teams).set({ image: input.image }).where(eq(teams.id, input.groupId));
      }
    }),

  // ── Department sub-router ─────────────────────────────────────────────────

  department: router({
    create: protectedProcedure
      .input(
        z.object({
          orgId: z.string().uuid(),
          name: z.string().min(1).max(100),
          slug: slugSchema.optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await requireOrgRole(ctx.db, ctx.session.userId, input.orgId, "admin", ctx.session.systemRole);
        const [dept] = await ctx.db
          .insert(departments)
          .values({ orgId: input.orgId, name: input.name, slug: input.slug })
          .returning();
        return dept;
      }),

    list: protectedProcedure
      .input(z.object({ orgId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await requireOrgRole(ctx.db, ctx.session.userId, input.orgId, "viewer", ctx.session.systemRole);
        return ctx.db.query.departments.findMany({
          where: eq(departments.orgId, input.orgId),
        });
      }),

    update: protectedProcedure
      .input(
        z.object({
          departmentId: z.string().uuid(),
          name: z.string().min(1).max(100).optional(),
          slug: slugSchema.optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const dept = await ctx.db.query.departments.findFirst({
          where: eq(departments.id, input.departmentId),
        });
        if (!dept) throw new TRPCError({ code: "NOT_FOUND" });
        await requireOrgRole(ctx.db, ctx.session.userId, dept.orgId, "admin", ctx.session.systemRole);
        const [updated] = await ctx.db
          .update(departments)
          .set({
            ...(input.name !== undefined && { name: input.name }),
            ...(input.slug !== undefined && { slug: input.slug }),
          })
          .where(eq(departments.id, input.departmentId))
          .returning();
        return updated;
      }),

    delete: protectedProcedure
      .input(z.object({ departmentId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const dept = await ctx.db.query.departments.findFirst({
          where: eq(departments.id, input.departmentId),
        });
        if (!dept) throw new TRPCError({ code: "NOT_FOUND" });
        await requireOrgRole(ctx.db, ctx.session.userId, dept.orgId, "admin", ctx.session.systemRole);

        await ctx.db.transaction(async (tx) => {
          const childTeams = await tx
            .select({ id: teams.id })
            .from(teams)
            .where(eq(teams.departmentId, input.departmentId));
          const childTeamIds = childTeams.map((t) => t.id);

          // Delete artifacts owned by dept
          await tx.delete(artifacts).where(
            and(eq(artifacts.ownerType, "department"), eq(artifacts.ownerId, input.departmentId)),
          );
          // Delete artifacts owned by child teams
          if (childTeamIds.length > 0) {
            await tx.delete(artifacts).where(
              and(eq(artifacts.ownerType, "team"), inArray(artifacts.ownerId, childTeamIds)),
            );
            await tx.delete(memberships).where(
              and(eq(memberships.groupType, "team"), inArray(memberships.groupId, childTeamIds)),
            );
          }
          // Delete dept-level memberships
          await tx.delete(memberships).where(
            and(eq(memberships.groupType, "department"), eq(memberships.groupId, input.departmentId)),
          );
          // Delete dept (teams cascade via FK)
          await tx.delete(departments).where(eq(departments.id, input.departmentId));
        });
      }),

    // ── Team sub-router ─────────────────────────────────────────────────────

    team: router({
      create: protectedProcedure
        .input(
          z.object({
            departmentId: z.string().uuid(),
            name: z.string().min(1).max(100),
            slug: slugSchema.optional(),
          }),
        )
        .mutation(async ({ ctx, input }) => {
          if (!(await ctx.db.query.departments.findFirst({ where: eq(departments.id, input.departmentId) })))
            throw new TRPCError({ code: "NOT_FOUND" });
          await requireGroupAdmin(ctx.db, ctx.session.userId, "department", input.departmentId, ctx.session.systemRole);
          const [team] = await ctx.db
            .insert(teams)
            .values({ departmentId: input.departmentId, name: input.name, slug: input.slug })
            .returning();
          return team;
        }),

      list: protectedProcedure
        .input(z.object({ departmentId: z.string().uuid() }))
        .query(async ({ ctx, input }) => {
          const dept = await ctx.db.query.departments.findFirst({
            where: eq(departments.id, input.departmentId),
          });
          if (!dept) throw new TRPCError({ code: "NOT_FOUND" });
          await requireOrgRole(ctx.db, ctx.session.userId, dept.orgId, "viewer", ctx.session.systemRole);
          return ctx.db.query.teams.findMany({
            where: eq(teams.departmentId, input.departmentId),
          });
        }),

      update: protectedProcedure
        .input(
          z.object({
            teamId: z.string().uuid(),
            name: z.string().min(1).max(100).optional(),
            slug: slugSchema.optional(),
          }),
        )
        .mutation(async ({ ctx, input }) => {
          if (!(await ctx.db.query.teams.findFirst({ where: eq(teams.id, input.teamId) })))
            throw new TRPCError({ code: "NOT_FOUND" });
          await requireGroupAdmin(ctx.db, ctx.session.userId, "team", input.teamId, ctx.session.systemRole);
          const [updated] = await ctx.db
            .update(teams)
            .set({
              ...(input.name !== undefined && { name: input.name }),
              ...(input.slug !== undefined && { slug: input.slug }),
            })
            .where(eq(teams.id, input.teamId))
            .returning();
          return updated;
        }),

      delete: protectedProcedure
        .input(z.object({ teamId: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
          if (!(await ctx.db.query.teams.findFirst({ where: eq(teams.id, input.teamId) })))
            throw new TRPCError({ code: "NOT_FOUND" });
          await requireGroupAdmin(ctx.db, ctx.session.userId, "team", input.teamId, ctx.session.systemRole);

          await ctx.db.transaction(async (tx) => {
            await tx.delete(artifacts).where(
              and(eq(artifacts.ownerType, "team"), eq(artifacts.ownerId, input.teamId)),
            );
            await tx.delete(memberships).where(
              and(eq(memberships.groupType, "team"), eq(memberships.groupId, input.teamId)),
            );
            await tx.delete(teams).where(eq(teams.id, input.teamId));
          });
        }),
    }),
  }),

  // ── Membership sub-router ─────────────────────────────────────────────────

  membership: router({
    add: protectedProcedure
      .input(
        z
          .object({
            userId: z.string().uuid().optional(),
            email: z.string().email().optional(),
            groupType: z.enum(["org", "department", "team"]),
            groupId: z.string().uuid(),
            role: z.enum(["viewer", "editor", "admin"]).default("editor"),
          })
          .refine((d) => d.userId || d.email, { message: "userId or email is required" }),
      )
      .mutation(async ({ ctx, input }) => {
        await requireGroupAdmin(ctx.db, ctx.session.userId, input.groupType, input.groupId, ctx.session.systemRole);

        const target = input.userId
          ? await ctx.db.query.users.findFirst({ where: eq(users.id, input.userId) })
          : await ctx.db.query.users.findFirst({ where: eq(users.email, input.email!) });
        if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

        const [membership] = await ctx.db
          .insert(memberships)
          .values({
            userId: target.id,
            groupType: input.groupType,
            groupId: input.groupId,
            role: input.role,
          })
          .onConflictDoUpdate({
            target: [memberships.userId, memberships.groupType, memberships.groupId],
            set: { role: input.role },
          })
          .returning();
        return membership;
      }),

    updateRole: protectedProcedure
      .input(
        z.object({
          membershipId: z.string().uuid(),
          role: z.enum(["viewer", "editor", "admin"]),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const m = await ctx.db.query.memberships.findFirst({
          where: eq(memberships.id, input.membershipId),
        });
        if (!m) throw new TRPCError({ code: "NOT_FOUND" });

        await requireGroupAdmin(ctx.db, ctx.session.userId, m.groupType, m.groupId, ctx.session.systemRole);

        // Guard: cannot demote the last org-level admin
        if (m.role === "admin" && input.role !== "admin") {
          await ensureNotLastOrgAdmin(ctx.db, input.membershipId);
        }

        const [updated] = await ctx.db
          .update(memberships)
          .set({ role: input.role })
          .where(eq(memberships.id, input.membershipId))
          .returning();
        return updated;
      }),

    remove: protectedProcedure
      .input(z.object({ membershipId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const m = await ctx.db.query.memberships.findFirst({
          where: eq(memberships.id, input.membershipId),
        });
        if (!m) throw new TRPCError({ code: "NOT_FOUND" });

        await requireGroupAdmin(ctx.db, ctx.session.userId, m.groupType, m.groupId, ctx.session.systemRole);

        // Guard: cannot remove the last org-level admin
        await ensureNotLastOrgAdmin(ctx.db, input.membershipId);

        await ctx.db.delete(memberships).where(eq(memberships.id, input.membershipId));
      }),

    listForGroup: protectedProcedure
      .input(
        z.object({
          groupType: z.enum(["org", "department", "team"]),
          groupId: z.string().uuid(),
        }),
      )
      .query(async ({ ctx, input }) => {
        const rows = await ctx.db
          .select({
            id: memberships.id,
            role: memberships.role,
            userId: memberships.userId,
            userName: users.name,
            userEmail: users.email,
          })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(
            and(
              eq(memberships.groupType, input.groupType),
              eq(memberships.groupId, input.groupId),
            ),
          );
        return rows;
      }),
  }),
});
