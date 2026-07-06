import { InMemoryRateLimiter } from "./memory";

export type ConsumeResult = { ok: boolean; retryAfterMs: number };

/**
 * Pluggable rate limiter (Phase 46). Same shape as the Embedder abstraction
 * (server/embedder/index.ts): one interface, a globalThis singleton, and a
 * factory that picks the implementation from an env var — so a future
 * shared-store backend (Redis/Memcached) drops in without touching any of
 * the three call sites (login / register / MCP).
 *
 * `consume` returns `{ ok }` = whether this hit is allowed, and when it isn't,
 * `retryAfterMs` = how long until the window frees up (for a Retry-After header).
 */
export interface RateLimiter {
  consume(key: string, opts: { max: number; windowMs: number }): Promise<ConsumeResult>;
}

// globalThis singleton — a plain module `let` does NOT reliably share state
// across module realms in Next (same reason documented in
// server/embedder/index.ts and server/lib/version-cache.ts, D-018).
const g = globalThis as unknown as { __rateLimiter?: RateLimiter };

function createFromEnv(): RateLimiter {
  const store = process.env.RATE_LIMIT_STORE ?? "memory";
  switch (store) {
    // Future: case "redis": return new RedisRateLimiter(process.env.REDIS_URL!)
    case "memory":
    default:
      return new InMemoryRateLimiter();
  }
}

export function getRateLimiter(): RateLimiter {
  if (!g.__rateLimiter) g.__rateLimiter = createFromEnv();
  return g.__rateLimiter;
}

/** Test seam — override the singleton (e.g. a fresh in-memory instance per test). */
export function setRateLimiter(rl: RateLimiter): void {
  g.__rateLimiter = rl;
}

/**
 * Best-effort client IP for rate-limit keying. Trusts `x-forwarded-for` only
 * when AUTH_TRUST_HOST is set (self-host behind a reverse proxy) — otherwise
 * the header is attacker-controlled and would let a caller forge unlimited
 * distinct keys to slip past the limiter. Uses the first hop (client) of XFF.
 */
export function getClientIp(req: Request | undefined | null): string {
  const trustProxy = process.env.AUTH_TRUST_HOST === "true";
  if (trustProxy && req?.headers) {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) {
      const first = xff.split(",")[0]?.trim();
      if (first) return first;
    }
    const xReal = req.headers.get("x-real-ip");
    if (xReal) return xReal.trim();
  }
  // No trusted source of the real IP — fall back to a single shared bucket.
  // Conservative: without a proxy telling us the client IP, everyone shares
  // one counter rather than each forging their own.
  return "unknown";
}
