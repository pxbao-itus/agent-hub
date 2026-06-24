import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { mcpTokens } from "@/server/db/schema";
import { eq, desc } from "drizzle-orm";
import { TokenManager } from "./_components/token-manager";

export const metadata = { title: "MCP Tokens" };

export default async function TokensPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const tokens = await db.query.mcpTokens.findMany({
    where: eq(mcpTokens.userId, session.user.id),
    orderBy: desc(mcpTokens.createdAt),
    columns: {
      id: true,
      name: true,
      tokenPrefix: true,
      expiresAt: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">MCP Tokens</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tokens grant AI agents (e.g. Claude Code) access to your prompts via the MCP endpoint.
          Each token inherits your own access level.
        </p>
      </div>


<TokenManager
        initial={tokens}
        endpoint={`${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/api/mcp`}
      />
    </div>
  );
}
