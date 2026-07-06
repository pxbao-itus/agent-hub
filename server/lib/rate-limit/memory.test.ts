import { describe, it, expect } from "vitest";
import { InMemoryRateLimiter } from "./memory";

// Injectable clock so windows advance deterministically without fake timers.
function clockLimiter() {
  let t = 1_000_000;
  const rl = new InMemoryRateLimiter(() => t);
  return { rl, advance: (ms: number) => { t += ms; } };
}

const OPTS = { max: 3, windowMs: 1000 };

describe("InMemoryRateLimiter", () => {
  it("allows up to `max` hits within a window, then blocks", async () => {
    const { rl } = clockLimiter();
    expect((await rl.consume("k", OPTS)).ok).toBe(true);
    expect((await rl.consume("k", OPTS)).ok).toBe(true);
    expect((await rl.consume("k", OPTS)).ok).toBe(true);
    const blocked = await rl.consume("k", OPTS);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets once the window elapses", async () => {
    const { rl, advance } = clockLimiter();
    for (let i = 0; i < 3; i++) await rl.consume("k", OPTS);
    expect((await rl.consume("k", OPTS)).ok).toBe(false);

    advance(1000); // window fully elapsed
    expect((await rl.consume("k", OPTS)).ok).toBe(true);
  });

  it("reports a shrinking retryAfter as the window drains", async () => {
    const { rl, advance } = clockLimiter();
    for (let i = 0; i < 3; i++) await rl.consume("k", OPTS);

    const early = await rl.consume("k", OPTS);
    advance(400);
    const later = await rl.consume("k", OPTS);
    expect(early.ok).toBe(false);
    expect(later.ok).toBe(false);
    expect(later.retryAfterMs).toBeLessThan(early.retryAfterMs);
  });

  it("keys are independent", async () => {
    const { rl } = clockLimiter();
    for (let i = 0; i < 3; i++) await rl.consume("a", OPTS);
    expect((await rl.consume("a", OPTS)).ok).toBe(false);
    // A different key has its own fresh window.
    expect((await rl.consume("b", OPTS)).ok).toBe(true);
  });

  it("prunes an expired bucket without disturbing a still-active one under a longer window", async () => {
    const { rl, advance } = clockLimiter();
    const LONG = { max: 2, windowMs: 10_000 };
    const SHORT = { max: 2, windowMs: 500 };

    // Long-window key hit once (count=1, window nowhere near elapsed).
    await rl.consume("long", LONG);
    // Short-window key opens/expires, triggering a prune sweep at t+600.
    await rl.consume("short", SHORT);
    advance(600);
    await rl.consume("short", SHORT); // opens new window → pruneExpired runs

    // "long" must still be at count=1 (its own 10s window hasn't elapsed). If
    // prune had used the caller's (short) windowMs it'd have dropped "long",
    // resetting it — then BOTH consumes below would pass. Correct behaviour:
    // one more hit allowed (→2 = max), the next blocked.
    const r1 = await rl.consume("long", LONG);
    const r2 = await rl.consume("long", LONG);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
  });
});
