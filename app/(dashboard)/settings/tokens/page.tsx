import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SquareTerminal } from "lucide-react";
import { db } from "@/server/db";
import { mcpTokens } from "@/server/db/schema";
import { eq, desc } from "drizzle-orm";
import { TokenManager } from "./_components/token-manager";
import { Button } from "@/components/ui/button";

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
      scope: true,
      expiresAt: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">MCP Tokens</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tokens grant AI agents (e.g. Claude Code) access to your prompts via the MCP endpoint.
            Each token inherits your own access level.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/cli">
            <SquareTerminal className="h-4 w-4" />
            Install Agent Hub CLI
          </Link>
        </Button>
      </div>


<TokenManager
        initial={tokens}
        endpoint={`${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/api/mcp`}
      />
    </div>
  );
}
