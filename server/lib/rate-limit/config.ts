/**
 * Rate-limit thresholds per protected surface, env-overridable with
 * sane defaults. Windows in ms. Read once at module load — restart to change.
 */
function num(envVar: string | undefined, fallback: number): number {
  const n = Number(envVar);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const rateLimitConfig = {
  // Sign-in: brute-force protection, per client IP. Generous enough for a
  // human mistyping a few times; low enough to make guessing impractical.
  login: {
    max: num(process.env.RATE_LIMIT_LOGIN_MAX, 10),
    windowMs: num(process.env.RATE_LIMIT_LOGIN_WINDOW_MS, 60_000),
  },
  // Registration, per client IP — curbs mass account creation.
  register: {
    max: num(process.env.RATE_LIMIT_REGISTER_MAX, 5),
    windowMs: num(process.env.RATE_LIMIT_REGISTER_WINDOW_MS, 60_000),
  },
  // MCP endpoint, per token (agents poll frequently, so higher).
  mcp: {
    max: num(process.env.RATE_LIMIT_MCP_MAX, 120),
    windowMs: num(process.env.RATE_LIMIT_MCP_WINDOW_MS, 60_000),
  },
} as const;
