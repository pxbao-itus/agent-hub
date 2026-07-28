import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Lets the QA harness run alongside a developer's active `next dev`
  // process without both instances contending for `.next/dev/lock`.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  outputFileTracingIncludes: {
    "/help": ["./content/help/**/*.md"],
    "/help/*": ["./content/help/**/*.md"],
  },
  serverExternalPackages: ["argon2", "pg", "@huggingface/transformers"],
};

export default nextConfig;
