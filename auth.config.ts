import type { NextAuthConfig } from "next-auth";

/**
 * Edge-compatible auth config — no DB or Node.js-only imports.
 * Used by the proxy (middleware) which runs on the Edge runtime.
 * The full auth.ts extends this with the DrizzleAdapter and Credentials provider.
 */
export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isPublic =
        pathname.startsWith("/auth/") ||
        pathname.startsWith("/api/auth");
      return isPublic || !!auth;
    },
  },
  providers: [],
};
