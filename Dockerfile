# Node 22: matches the dev environment, and pnpm 11 (lockfile v9) requires
# Node >= 22.13 — node:20 + pnpm@latest crashed the build ("No such built-in
# module: node:sqlite").
FROM node:22-alpine AS base

# Install pnpm — pinned (not @latest) so a future pnpm release can't silently
# break the image build the way an unpinned @latest just did.
RUN corepack enable && corepack prepare pnpm@11.0.8 --activate

# Install build deps for native modules (argon2)
RUN apk add --no-cache python3 make g++ linux-headers

# ── deps ──────────────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# pnpm 10+ blocks dependency build scripts unless approved. This image builds
# a fixed, pinned dependency set, so allowing the builds is the pre-pnpm-10
# trust model — needed for argon2 (password hashing) + onnxruntime-node to
# compile. (The `onlyBuiltDependencies` allowlist in pnpm-workspace.yaml is
# the cleaner mechanism, but pnpm 11.0.8 doesn't honor it — hence the flag.)
RUN pnpm install --frozen-lockfile --config.dangerouslyAllowAllBuilds=true

# ── builder ───────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time env (only public vars needed at build; secrets injected at runtime)
ARG DATABASE_URL
ENV DATABASE_URL=${DATABASE_URL}
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm build

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# Copy build output
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
