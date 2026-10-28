import type { ConsumeResult, RateLimiter } from "./index";

type Bucket = { count: number; windowStartMs: number; windowMs: number };

/**
 * In-memory fixed-window rate limiter. Counters live in a Map on
 * globalThis — same pattern/caveats as version-cache.ts: behaves
 * identically under tests, dev, and prod, no framework cache API.
 *
 * CAVEAT (documented, accepted for a single-instance self-host): state is
 * per-process — it resets on restart and is NOT shared across horizontally
 * scaled instances, so a caller rotating across instances isn't fully
 * throttled. The RateLimiter interface + getRateLimiter() factory exist so a
 * shared store (Redis/Memcached) can replace this without touching call sites.
 *
 * `now` is injectable for deterministic tests (avoids Date.now(), which is
 * also what keeps this unit-testable without faking timers).
 */
export class InMemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async consume(key: string, opts: { max: number; windowMs: number }): Promise<ConsumeResult> {
    const t = this.now();
    const bucket = this.buckets.get(key);

    // No bucket, or the previous window has fully elapsed → start fresh.
    if (!bucket || t - bucket.windowStartMs >= opts.windowMs) {
      this.buckets.set(key, { count: 1, windowStartMs: t, windowMs: opts.windowMs });
      this.pruneExpired(t);
      return { ok: true, retryAfterMs: 0 };
    }

    if (bucket.count >= opts.max) {
      return { ok: false, retryAfterMs: bucket.windowStartMs + opts.windowMs - t };
    }

    bucket.count += 1;
    return { ok: true, retryAfterMs: 0 };
  }

  /**
   * Lazy cleanup so the Map can't grow unbounded from one-off keys (e.g. a
   * spray of distinct IPs). Runs only when a new window opens, and only drops
   * buckets past their OWN window (keys from different endpoints carry
   * different windowMs) — cheap and correctness-neutral.
   */
  private pruneExpired(t: number) {
    for (const [k, b] of this.buckets) {
      if (t - b.windowStartMs >= b.windowMs) this.buckets.delete(k);
    }
  }
}
