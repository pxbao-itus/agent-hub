#!/bin/sh
# Applies the schema (schema.ts is the single source of truth — no versioned
# migrations, see D-019) on every container start, before the app boots. This
# is what makes `docker compose up` a true one-command self-host: there is no
# separate manual "apply migrations" step to remember (or to have silently
# never work — the previous instructions ran a binary that isn't even present
# in this image's runtime layer).
#
# --force skips the interactive confirmation prompt (there's no TTY here),
# which means a schema change involving potential data loss (e.g. a dropped
# column) applies automatically on next restart, with no review step. For a
# single-instance self-host this trade-off favors "no forgotten manual step"
# over "a confirmation prompt nobody would see anyway" — but it does mean a
# schema mistake lands immediately on every restart. Review schema.ts changes
# before deploying, the same care a hand-run migration would need anyway.
set -e

echo "Applying database schema (drizzle-kit push)..."
node_modules/.bin/drizzle-kit push --force

echo "Backfilling immutable usernames..."
node_modules/.bin/tsx server/scripts/backfill-usernames.ts

exec "$@"
