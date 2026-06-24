"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SetupGuide } from "./setup-guide";

type TokenRow = {
  id: string;
  name: string;
  tokenPrefix: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
};

export function TokenManager({
  initial,
  endpoint,
}: {
  initial: TokenRow[];
  endpoint: string;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  const create = trpc.token.create.useMutation({
    onSuccess: (data) => {
      setName("");
      setRevealed(data.rawToken);
      setGuideOpen(false); // guide shown inline after reveal
      utils.token.list.invalidate();
    },
  });
  const revoke = trpc.token.revoke.useMutation({
    onSuccess: () => utils.token.list.invalidate(),
  });

  const { data: tokens = initial } = trpc.token.list.useQuery(undefined, {
    initialData: initial,
  });

  function copyToken() {
    if (!revealed) return;
    navigator.clipboard.writeText(revealed);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  }

  return (
    <div className="space-y-8">
      {/* ── Revealed token + inline setup guide ─────────────────────────── */}
      {revealed && (
        <div className="rounded-lg border border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/30 divide-y divide-yellow-500/20">
          {/* Token copy */}
          <div className="p-4 space-y-2">
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
              Copy this token now — it will not be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-white/80 dark:bg-black/40 px-3 py-2 font-mono text-xs break-all border">
                {revealed}
              </code>
              <Button size="sm" variant="outline" onClick={copyToken}>
                {tokenCopied ? "Copied!" : "Copy"}
              </Button>
            </div>
          </div>

          {/* Setup guide inline */}
          <div className="p-4 space-y-2">
            <p className="text-xs font-medium text-yellow-800 dark:text-yellow-200">
              Connect an agent
            </p>
            <SetupGuide endpoint={endpoint} token={revealed} />
          </div>

          <div className="px-4 py-2">
            <Button
              size="sm"
              variant="ghost"
              className="text-xs"
              onClick={() => setRevealed(null)}
            >
              I've saved it, dismiss
            </Button>
          </div>
        </div>
      )}

      {/* ── Create form ──────────────────────────────────────────────────── */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ name });
        }}
        className="flex max-w-sm gap-2"
      >
        <div className="flex-1 space-y-1">
          <Label htmlFor="token-name" className="text-xs">
            New token name
          </Label>
          <Input
            id="token-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. claude-code-local"
            className="h-8 text-sm"
            required
          />
        </div>
        <Button type="submit" size="sm" disabled={create.isPending} className="self-end">
          {create.isPending ? "Creating…" : "Generate"}
        </Button>
      </form>

      {/* ── Token list ───────────────────────────────────────────────────── */}
      <div className="space-y-2">
        {tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tokens yet.</p>
        ) : (
          tokens.map((t) => (
            <Card key={t.id}>
              <CardContent className="flex items-center justify-between py-3 px-4">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{t.name}</span>
                    {t.expiresAt && new Date(t.expiresAt) < new Date() && (
                      <Badge
                        variant="outline"
                        className="text-destructive border-destructive text-[10px]"
                      >
                        expired
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <code>{t.tokenPrefix}…</code>
                    {t.lastUsedAt && (
                      <span>last used {new Date(t.lastUsedAt).toLocaleDateString()}</span>
                    )}
                    {t.expiresAt && (
                      <span>expires {new Date(t.expiresAt).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={revoke.isPending}
                  onClick={() => {
                    if (confirm("Revoke this token?")) revoke.mutate({ id: t.id });
                  }}
                >
                  Revoke
                </Button>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* ── Persistent setup guide (collapsible) ─────────────────────────── */}
      {!revealed && (
        <div className="rounded-lg border">
          <button
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/40 transition-colors rounded-lg"
            onClick={() => setGuideOpen((v) => !v)}
          >
            <span>How to connect an agent</span>
            <span className="text-muted-foreground text-xs">{guideOpen ? "▲" : "▼"}</span>
          </button>
          {guideOpen && (
            <div className="border-t px-4 py-4">
              <SetupGuide endpoint={endpoint} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
