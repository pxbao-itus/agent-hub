import { z } from "zod";
import { eq, and, inArray } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { orgs, departments, teams, memberships, users } from "@/server/db/schema";
import { TRPCError } from "@trpc/server";
import type { DbClient } from "@/server/db/types";
import { resolveOwnerSlugPaths } from "@/server/lib/owner-path";

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

// ── Org router ────────────────────────────────────────────────────────────────

export const orgRouter = router({
  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100), slug: slugSchema }))
    .mutation(async ({ ctx, input }) => {
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
        ? ctx.db.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, deptIds))
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
          const dept = await ctx.db.query.departments.findFirst({
            where: eq(departments.id, input.departmentId),
          });
          if (!dept) throw new TRPCError({ code: "NOT_FOUND" });
          await requireOrgRole(ctx.db, ctx.session.userId, dept.orgId, "admin", ctx.session.systemRole);
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
    }),
  }),

  // ── Membership sub-router ─────────────────────────────────────────────────

  membership: router({
    add: protectedProcedure
      .input(
        z.object({
          email: z.string().email(),
          groupType: z.enum(["org", "department", "team"]),
          groupId: z.string().uuid(),
          role: z.enum(["viewer", "editor", "admin"]).default("editor"),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Resolve parent org for auth check
        let orgId: string;
        if (input.groupType === "org") {
          orgId = input.groupId;
        } else if (input.groupType === "department") {
          const dept = await ctx.db.query.departments.findFirst({
            where: eq(departments.id, input.groupId),
          });
          if (!dept) throw new TRPCError({ code: "NOT_FOUND" });
          orgId = dept.orgId;
        } else {
          const team = await ctx.db.query.teams.findFirst({
            where: eq(teams.id, input.groupId),
          });
          if (!team) throw new TRPCError({ code: "NOT_FOUND" });
          const dept = await ctx.db.query.departments.findFirst({
            where: eq(departments.id, team.departmentId),
          });
          if (!dept) throw new TRPCError({ code: "NOT_FOUND" });
          orgId = dept.orgId;
        }
        await requireOrgRole(ctx.db, ctx.session.userId, orgId, "admin", ctx.session.systemRole);

        const target = await ctx.db.query.users.findFirst({
          where: eq(users.email, input.email),
        });
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
