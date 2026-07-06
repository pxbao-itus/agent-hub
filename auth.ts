import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { authConfig } from "@/auth.config";
import { authorizeCredentials } from "@/server/auth/credentials";

const providers = [
  Credentials({
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    authorize: (credentials, request) => authorizeCredentials(credentials, request as Request | undefined),
  }),
  // OAuth providers are only registered when env vars are present.
  ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
    ? [Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET, allowDangerousEmailAccountLinking: true })]
    : []),
  ...(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET
    ? [GitHub({ clientId: process.env.AUTH_GITHUB_ID, clientSecret: process.env.AUTH_GITHUB_SECRET, allowDangerousEmailAccountLinking: true })]
    : []),
];

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db),
  providers,
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
        // Load systemRole from DB so it works for both Credentials and OAuth.
        const dbUser = await db.query.users.findFirst({
          where: eq(schema.users.id, user.id),
        });
        token.systemRole = dbUser?.systemRole ?? "user";
      }
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string;
      session.user.systemRole = (token.systemRole as "user" | "superadmin") ?? "user";
      return session;
    },
  },
});
