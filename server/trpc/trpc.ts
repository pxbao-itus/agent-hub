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

/** Procedure yêu cầu đăng nhập. Auth thật sự sẽ nối ở Phase 2. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  // TODO(Phase 2): kiểm tra ctx.session, throw UNAUTHORIZED nếu chưa đăng nhập.
  return next({ ctx });
});
