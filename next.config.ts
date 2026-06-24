import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["argon2", "pg", "@huggingface/transformers"],
};

export default nextConfig;
