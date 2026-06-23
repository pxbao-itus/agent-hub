import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

/** Procedure that requires an authenticated session. Enforced in Phase 2. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  // TODO(Phase 2): check ctx.session, throw UNAUTHORIZED if not signed in.
  return next({ ctx });
});
