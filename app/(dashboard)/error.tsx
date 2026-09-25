"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { classifyHealthPayload, describeFailure, type FailureKind } from "@/lib/error-copy";

const PROBE_TIMEOUT_MS = 3_000;

/**
 * Ask the server what state it's in. The caught error can't tell us: Next.js
 * replaces server-component messages with boilerplate in production builds,
 * and in dev they're raw driver dumps. /api/health answers the one question
 * that changes the advice we give — is the database reachable?
 */
async function probeHealth(signal: AbortSignal): Promise<FailureKind> {
  const res = await fetch("/api/health", { signal, cache: "no-store" });
  // A dead database answers 503 with a body, so status alone isn't the signal.
  const body = await res.json().catch(() => null);
  return classifyHealthPayload(body);
}

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [kind, setKind] = useState<FailureKind>("checking");

  useEffect(() => { console.error(error); }, [error]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    let active = true;

    probeHealth(controller.signal)
      .then((result) => { if (active) setKind(result); })
      // An aborted or failed probe means we never reached the server at all.
      .catch(() => { if (active) setKind("unreachable"); })
      .finally(() => clearTimeout(timer));

    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [error]);

  const { title, detail } = describeFailure(kind);

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
      <p className="text-lg font-semibold">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{detail}</p>

      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
      )}

      <Button variant="outline" onClick={reset} disabled={kind === "checking"}>
        Try again
      </Button>

      {/* Dev only: the raw message carries SQL and bound parameters, which
          have no business rendering in a browser outside local debugging. */}
      {process.env.NODE_ENV !== "production" && error.message && (
        <details className="max-w-2xl text-left">
          <summary className="cursor-pointer text-xs text-muted-foreground">Technical details (dev only)</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">{error.message}</pre>
        </details>
      )}
    </div>
  );
}
