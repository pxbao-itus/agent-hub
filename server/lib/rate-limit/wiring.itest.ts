import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { setRateLimiter, getRateLimiter } from "./index";
import { InMemoryRateLimiter } from "./memory";
import { rateLimitConfig } from "./config";
import { POST as registerPOST } from "@/app/api/auth/register/route";
import { POST as mcpPOST } from "@/app/api/mcp/route";
import { authorizeCredentials } from "@/server/auth/credentials";

// seed-test.ts's shared password. Not imported from there — that module runs
// its reset+seed on import.
const SEED_PASSWORD = "Test1234!";

/**
 * Verifies the rate-limit *wiring* on the two directly-callable route handlers
 * (register, MCP) — that each calls the limiter with the right key and returns
 * 429 when it's exhausted. The limiter algorithm itself is unit-tested in
 * memory.test.ts; here we drive the real handlers. Login uses the identical
 * three-line pattern inside NextAuth's `authorize` (not directly importable),
 * covered by code review + the shared, tested machinery.
 *
 * A fresh in-memory limiter per test isolates state; no client IP is set on
 * these requests, so `getClientIp` returns "unknown" (AUTH_TRUST_HOST unset)
 * and the keys are deterministic — we exhaust exactly those.
 */
beforeEach(() => setRateLimiter(new InMemoryRateLimiter()));

async function exhaust(key: string, cfg: { max: number; windowMs: number }) {
  for (let i = 0; i < cfg.max; i++) await getRateLimiter().consume(key, cfg);
}

describe("register route — rate limiting", () => {
  it("passes the limiter through to validation when under the limit", async () => {
    const req = new NextRequest("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ invalid: true }),
    });
    const res = await registerPOST(req);
    expect(res.status).toBe(400); // got past the limiter, then failed validation
  });

  it("returns 429 with Retry-After once the per-IP window is exhausted", async () => {
    await exhaust("register:unknown", rateLimitConfig.register);
    const req = new NextRequest("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name: "x", email: "rl-test@example.com", password: "password123" }),
    });
    const res = await registerPOST(req);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("MCP route — rate limiting", () => {
  it("returns 401 (not 429) with no token when under the limit", async () => {
    const res = await mcpPOST(new Request("http://localhost/api/mcp", { method: "POST" }));
    expect(res.status).toBe(401); // past the limiter, then unauthorized
  });

  it("returns 429 once the unauthenticated per-IP window is exhausted (token-guessing throttle)", async () => {
    await exhaust("mcp:ip:unknown", rateLimitConfig.mcp);
    const res = await mcpPOST(new Request("http://localhost/api/mcp", { method: "POST" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("login (authorizeCredentials) — rate limiting", () => {
  const creds = { email: "superadmin@test.local", password: SEED_PASSWORD };

  it("authenticates with correct credentials when under the limit", async () => {
    const user = await authorizeCredentials(creds, undefined);
    expect(user?.email).toBe("superadmin@test.local");
  });

  it("rejects even correct credentials once the per-IP window is exhausted", async () => {
    await exhaust("login:unknown", rateLimitConfig.login);
    const user = await authorizeCredentials(creds, undefined);
    expect(user).toBeNull(); // throttled — the whole point: a correct password can't get through
  });
});
