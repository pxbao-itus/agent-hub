import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // Plain "node_modules" only matches a literal top-level segment, not
    // nested ones — src/cli/ has its own node_modules (separate package,
    // plans/42-cli-filesystem-sync.md §4), and without the recursive glob
    // its vendored deps' own *.test.ts files (e.g. zod's) got picked up too.
    // cli/ is excluded outright, not just its node_modules — it's a fully
    // separate package (own package.json, own `pnpm test`), not part of
    // this app's test run.
    exclude: ["**/node_modules/**", "**/.next/**", "cli/**"],
  },
  resolve: {
    alias: { "@": resolve(__dirname, ".") },
  },
});
