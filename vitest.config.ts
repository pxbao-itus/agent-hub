import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // Plain "node_modules" only matches a literal top-level segment, not
    // nested ones — without the recursive glob, a vendored dep's own
    // *.test.ts files could get picked up too. src/cli/ is a separate Go
    // module with no *.test.ts files, so it's excluded
    // by this pattern automatically, no separate entry needed.
    exclude: ["**/node_modules/**", "**/.next/**"],
  },
  resolve: {
    alias: { "@": resolve(__dirname, ".") },
  },
});
