import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // React Compiler rules from eslint-plugin-react-hooks v6. The existing
    // forms and dialogs reset local state inside effects; fixing that means
    // restructuring components, so these stay visible as warnings for now.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
    },
  },
  {
    // The markdown tests render via createElement with a `children` prop.
    files: ["**/*.test.ts"],
    rules: { "react/no-children-prop": "off" },
  },
  globalIgnores([".next/**", ".next-*/**", "node_modules/**", "cli/**", "public/**", "next-env.d.ts"]),
]);
