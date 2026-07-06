import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/server/mcp/server";
import { verifyMcpToken } from "@/server/mcp/token";
import { db } from "@/server/db";
import { getRateLimiter, getClientIp } from "@/server/lib/rate-limit";
import { rateLimitConfig } from "@/server/lib/rate-limit/config";

export const runtime = "nodejs";

async function getIdentity(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const raw = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!raw) return null;
  return verifyMcpToken(raw, db);
}

function tooMany(retryAfterMs: number): Response {
  return Response.json(
    { error: "Too many requests" },
    { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
  );
}

async function handle(req: Request): Promise<Response> {
  const identity = await getIdentity(req);

  // Rate-limit per token when authenticated; per IP otherwise, so a stream of
  // unverifiable tokens (token guessing) is throttled too, not just 401'd.
  const { max, windowMs } = rateLimitConfig.mcp;
  const key = identity ? `mcp:token:${identity.tokenId}` : `mcp:ip:${getClientIp(req)}`;
  const limit = await getRateLimiter().consume(key, { max, windowMs });
  if (!limit.ok) return tooMany(limit.retryAfterMs);

  if (!identity) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = await createMcpServer(identity, identity.scope);
  await server.connect(transport);
  return transport.handleRequest(req);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
