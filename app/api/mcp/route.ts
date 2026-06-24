import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/server/mcp/server";
import { verifyMcpToken } from "@/server/mcp/token";
import { db } from "@/server/db";

export const runtime = "nodejs";

async function getIdentity(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const raw = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!raw) return null;
  return verifyMcpToken(raw, db);
}

async function handle(req: Request): Promise<Response> {
  const identity = await getIdentity(req);
  if (!identity) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = createMcpServer(identity);
  await server.connect(transport);
  return transport.handleRequest(req);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
