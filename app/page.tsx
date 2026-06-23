"use client";

import { trpc } from "@/lib/trpc/client";

export default function Home() {
  const health = trpc.health.useQuery();

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-bold">prompt-hub</h1>
      <p className="mt-2 text-sm opacity-70">
        Store, share, and use prompts — with AI agent integration over MCP.
      </p>

      <div className="mt-8 rounded-lg border border-black/10 p-4 dark:border-white/15">
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">
          Health
        </h2>
        <ul className="mt-2 space-y-1 text-sm">
          <li>app: {health.isLoading ? "…" : health.data?.ok ? "ok" : "down"}</li>
          <li>
            database:{" "}
            {health.isLoading ? "…" : health.data?.db ? "connected" : "not connected"}
          </li>
        </ul>
      </div>
    </main>
  );
}
