/**
 * Wording for the dashboard error boundary.
 *
 * The boundary can't read the error itself: Next.js strips server-component
 * error messages in production builds, so `error.message` is either a raw
 * Drizzle dump (dev — full SQL and bound params, not for a browser) or a
 * boilerplate paragraph about omitted details (prod). Neither tells a reader
 * what to do. Instead the boundary re-asks the server via /api/health and
 * turns that answer into prose here, which keeps the decision pure and
 * testable while the component stays a thin shell.
 */

export const FAILURE_KINDS = ["checking", "database", "unreachable", "application"] as const;

export type FailureKind = (typeof FAILURE_KINDS)[number];

export type FailureCopy = { title: string; detail: string };

/** True for the exact shape /api/health returns, and nothing else. */
function isHealthBody(value: unknown): value is { ok: boolean; db: boolean } {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return typeof body.ok === "boolean" && typeof body.db === "boolean";
}

/**
 * Decide what broke, given the parsed body of a /api/health response.
 * Only a well-formed body reporting `db: false` blames the database — the
 * probe got through, so anything else means the failure was the app's own.
 */
export function classifyHealthPayload(payload: unknown): Extract<FailureKind, "database" | "application"> {
  return isHealthBody(payload) && !payload.db ? "database" : "application";
}

const COPY: Record<FailureKind, FailureCopy> = {
  checking: {
    title: "Checking what went wrong",
    detail: "Working out whether this is a temporary outage or a problem with the page.",
  },
  database: {
    title: "Database unavailable",
    detail:
      "Agent Hub can't reach its database right now, so this page has no data to show. " +
      "Nothing you did caused this and nothing was lost. If you're running Agent Hub yourself, " +
      "check that the database container is up; otherwise try again in a few minutes.",
  },
  unreachable: {
    title: "Can't reach the server",
    detail:
      "The page loaded but the server stopped responding. Check your connection, then try again.",
  },
  application: {
    title: "Something went wrong",
    detail:
      "The server is healthy, so this looks like a bug on this page rather than an outage. " +
      "Try again — if it keeps happening, report it with the reference below.",
  },
};

export function describeFailure(kind: FailureKind): FailureCopy {
  return COPY[kind];
}
