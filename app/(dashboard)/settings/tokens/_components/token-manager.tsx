"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
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
  const [revokeTarget, setRevokeTarget] = useState<TokenRow | null>(null);

  const create = trpc.token.create.useMutation({
    onSuccess: (data) => {
      setName("");
      setRevealed(data.rawToken);
      setGuideOpen(false);
      utils.token.list.invalidate();
      toast({ title: "Token created", description: "Copy it now — it won't be shown again.", variant: "success" });
    },
    onError: (e) => toast({ title: "Failed to create token", description: e.message, variant: "destructive" }),
  });

  const revoke = trpc.token.revoke.useMutation({
    onSuccess: () => {
      utils.token.list.invalidate();
      setRevokeTarget(null);
      toast({ title: "Token revoked" });
    },
    onError: (e) => toast({ title: "Failed to revoke token", description: e.message, variant: "destructive" }),
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
        <div className="rounded-lg border border-warning/50 bg-warning/5 divide-y divide-warning/20">
          <div className="p-4 space-y-2">
            <p className="text-sm font-medium">
              Copy this token now — it will not be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-background px-3 py-2 font-mono text-xs break-all border">
                {revealed}
              </code>
              <Button size="sm" variant="outline" onClick={copyToken}>
                {tokenCopied ? "Copied!" : "Copy"}
              </Button>
            </div>
          </div>

          <div className="p-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Connect an agent</p>
            <SetupGuide endpoint={endpoint} token={revealed} />
          </div>

          <div className="px-4 py-2">
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => setRevealed(null)}>
              I&apos;ve saved it, dismiss
            </Button>
          </div>
        </div>
      )}

      {/* ── Create form ──────────────────────────────────────────────────── */}
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
                      <Badge variant="destructive">expired</Badge>
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
                  onClick={() => setRevokeTarget(t)}
                >
                  Revoke
                </Button>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* ── Revoke confirm dialog ─────────────────────────────────────────── */}
      <AlertDialog open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke &quot;{revokeTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              Any agents using this token will lose access immediately. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => revokeTarget && revoke.mutate({ id: revokeTarget.id })}
              disabled={revoke.isPending}
            >
              {revoke.isPending ? "Revoking…" : "Revoke"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
