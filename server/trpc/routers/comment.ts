import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import {
  CommentServiceError,
  createComment,
  deleteComment,
  findCollaborationArtifact,
  listComments,
  updateComment,
} from "@/server/services/comment";
import { canAccessArtifact, canMutatePrompt } from "@/server/auth/access";
import { getSubscription, setSubscription } from "@/server/services/subscription";
import { listArtifactActivity } from "@/server/services/artifact-activity";
import { asc, ilike, or } from "drizzle-orm";
import { users } from "@/server/db/schema";

function actor(ctx: { session: { userId: string; systemRole: "user" | "superadmin" } }) {
  return { userId: ctx.session.userId, systemRole: ctx.session.systemRole };
}

function mapCommentError(error: unknown): never {
  if (error instanceof CommentServiceError) {
    throw new TRPCError({ code: error.code, message: error.message });
  }
  throw error;
}

export const commentRouter = router({
  activity: protectedProcedure
    .input(
      z.object({
        artifactId: z.string().uuid(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await listArtifactActivity(input.artifactId, actor(ctx), input, ctx.db);
      } catch (error) {
        mapCommentError(error);
      }
    }),

  searchMentionCandidates: protectedProcedure
    .input(
      z.object({
        artifactId: z.string().uuid(),
        query: z.string().max(100),
        limit: z.number().int().min(1).max(20).default(10),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const artifact = await findCollaborationArtifact(input.artifactId, ctx.db);
        if (!(await canAccessArtifact(actor(ctx), artifact, ctx.db))) {
          throw new CommentServiceError("FORBIDDEN", "You cannot access this artifact.");
        }
        const normalizedQuery = input.query.trim();
        const q = `%${normalizedQuery}%`;
        const candidates = await ctx.db
          .select({
            id: users.id,
            name: users.name,
            username: users.username,
            email: users.email,
            image: users.image,
            systemRole: users.systemRole,
          })
          .from(users)
          .where(
            normalizedQuery
              ? or(ilike(users.username, q), ilike(users.name, q), ilike(users.email, q))
              : undefined,
          )
          .orderBy(asc(users.name), asc(users.username))
          .limit(input.limit * 5);
        const result: Array<{
          id: string;
          name: string | null;
          username: string;
          email: string;
          image: string | null;
        }> = [];
        for (const candidate of candidates) {
          if (result.length >= input.limit) break;
          if (!candidate.username) continue;
          if (
            await canAccessArtifact(
              { userId: candidate.id, systemRole: candidate.systemRole },
              artifact,
              ctx.db,
            )
          ) {
            result.push({
              id: candidate.id,
              name: candidate.name,
              username: candidate.username,
              email: candidate.email,
              image: candidate.image,
            });
          }
        }
        return result;
      } catch (error) {
        mapCommentError(error);
      }
    }),

  list: protectedProcedure
    .input(
      z.object({
        artifactId: z.string().uuid(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const artifact = await findCollaborationArtifact(input.artifactId, ctx.db);
        const identity = actor(ctx);
        const [result, canModerate] = await Promise.all([
          listComments(artifact, identity, input, ctx.db),
          canMutatePrompt(identity, artifact, ctx.db),
        ]);
        return {
          ...result,
          items: result.items.map((comment) => ({
            ...comment,
            canEdit: !comment.deletedAt && comment.authorId === identity.userId,
            canDelete:
              !comment.deletedAt &&
              (comment.authorId === identity.userId || canModerate),
          })),
        };
      } catch (error) {
        mapCommentError(error);
      }
    }),

  create: protectedProcedure
    .input(
      z.object({
        artifactId: z.string().uuid(),
        body: z.string().max(20_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const artifact = await findCollaborationArtifact(input.artifactId, ctx.db);
        return await createComment(artifact, { body: input.body }, actor(ctx), "ui", ctx.db);
      } catch (error) {
        mapCommentError(error);
      }
    }),

  update: protectedProcedure
    .input(
      z.object({
        commentId: z.string().uuid(),
        body: z.string().max(20_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateComment(input.commentId, { body: input.body }, actor(ctx), ctx.db);
      } catch (error) {
        mapCommentError(error);
      }
    }),

  delete: protectedProcedure
    .input(z.object({ commentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await deleteComment(input.commentId, actor(ctx), ctx.db);
      } catch (error) {
        mapCommentError(error);
      }
    }),

  getSubscription: protectedProcedure
    .input(z.object({ artifactId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      try {
        const artifact = await findCollaborationArtifact(input.artifactId, ctx.db);
        if (!(await canAccessArtifact(actor(ctx), artifact, ctx.db))) {
          throw new CommentServiceError("FORBIDDEN", "You cannot access this artifact.");
        }
        const row = await getSubscription(ctx.session.userId, artifact.id, ctx.db);
        return { mode: row?.mode ?? null };
      } catch (error) {
        mapCommentError(error);
      }
    }),

  setSubscription: protectedProcedure
    .input(
      z.object({
        artifactId: z.string().uuid(),
        mode: z.enum(["all", "mentions", "muted"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const artifact = await findCollaborationArtifact(input.artifactId, ctx.db);
        return await setSubscription(artifact, input.mode, actor(ctx), ctx.db);
      } catch (error) {
        mapCommentError(error);
      }
    }),
});
