"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type TokenRow = {
  id: string;
  name: string;
  tokenPrefix: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
};

export function TokenManager({ initial }: { initial: TokenRow[] }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = trpc.token.create.useMutation({
    onSuccess: (data) => {
      setName("");
      setRevealed(data.rawToken);
      utils.token.list.invalidate();
    },
  });
  const revoke = trpc.token.revoke.useMutation({
    onSuccess: () => utils.token.list.invalidate(),
  });

  const { data: tokens = initial } = trpc.token.list.useQuery(undefined, {
    initialData: initial,
  });

  function copy() {
    if (!revealed) return;
    navigator.clipboard.writeText(revealed);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-8">
      {/* Revealed token banner */}
      {revealed && (
        <div className="rounded-lg border border-yellow-500/50 bg-yellow-50 p-4 dark:bg-yellow-950/30 space-y-2">
          <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
            Copy this token now — it will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-white/80 dark:bg-black/40 px-3 py-2 font-mono text-xs break-all border">
              {revealed}
            </code>
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? "Copied!" : "Copy"}
            </Button>
          </div>
          <Button size="sm" variant="ghost" className="text-xs" onClick={() => setRevealed(null)}>
            I've saved it, dismiss
          </Button>
        </div>
      )}

      {/* Create form */}
      <form
        onSubmit={(e) => { e.preventDefault(); create.mutate({ name }); }}
        className="flex max-w-sm gap-2"
      >
        <div className="flex-1 space-y-1">
          <Label htmlFor="token-name" className="text-xs">New token name</Label>
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

      {/* Token list */}
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
                      <Badge variant="outline" className="text-destructive border-destructive text-[10px]">expired</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <code>{t.tokenPrefix}…</code>
                    {t.lastUsedAt && <span>last used {new Date(t.lastUsedAt).toLocaleDateString()}</span>}
                    {t.expiresAt && <span>expires {new Date(t.expiresAt).toLocaleDateString()}</span>}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={revoke.isPending}
                  onClick={() => { if (confirm("Revoke this token?")) revoke.mutate({ id: t.id }); }}
                >
                  Revoke
                </Button>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
