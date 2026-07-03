import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Edge-compatible proxy (Next.js 16). Uses authConfig which has no Node.js-only imports.
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/trpc|api/mcp|api/health).*)"],
};
