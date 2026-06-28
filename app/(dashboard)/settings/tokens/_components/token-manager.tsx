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

type ScopeEntry = { groupType: "org" | "department" | "team"; groupId: string };

type TokenRow = {
  id: string;
  name: string;
  tokenPrefix: string;
  scope: unknown;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
};

function scopeSummary(scope: unknown): string {
  if (!scope || typeof scope !== "object") return "Full access";
  const s = scope as { spaces?: ScopeEntry[]; tags?: string[] };
  const parts: string[] = [];
  if (s.spaces?.length) parts.push(`${s.spaces.length} space${s.spaces.length !== 1 ? "s" : ""}`);
  if (s.tags?.length) parts.push(`${s.tags.length} tag${s.tags.length !== 1 ? "s" : ""}`);
  return parts.length ? parts.join(" · ") : "Full access";
}

export function TokenManager({
  initial,
  endpoint,
}: {
  initial: TokenRow[];
  endpoint: string;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<TokenRow | null>(null);

  const mySpaces = trpc.org.mySpaces.useQuery();
  const [selectedSpaceKeys, setSelectedSpaceKeys] = useState<string[]>([]);

  function toggleSpace(key: string) {
    setSelectedSpaceKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  const create = trpc.token.create.useMutation({
    onSuccess: (data) => {
      setName("");
      setTagInput("");
      setSelectedSpaceKeys([]);
      setRevealed(data.rawToken);
      setGuideOpen(false);
      utils.token.list.invalidate();
      toast({ title: "Token created", description: "Copy it now — it won't be shown again.", variant: "success" });
    },
    onError: (e) => toast({ title: "Failed to create token", description: e.message, variant: "destructive" }),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const tags = tagInput.split(",").map((t) => t.trim()).filter(Boolean);
    const spaces: ScopeEntry[] = selectedSpaceKeys.map((k) => {
      const [groupType, groupId] = k.split(":");
      return { groupType: groupType as ScopeEntry["groupType"], groupId };
    });
    const scope = spaces.length || tags.length ? { spaces, tags } : undefined;
    create.mutate({ name, scope });
  }

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
      <form onSubmit={handleCreate} className="space-y-3 max-w-sm">
        <div className="space-y-1">
          <Label htmlFor="token-name" className="text-xs">Token name</Label>
          <Input
            id="token-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. claude-code-local"
            className="h-8 text-sm"
            required
          />
        </div>

        {/* Optional: restrict to specific spaces */}
        {mySpaces.data && mySpaces.data.length > 0 && (
          <div className="space-y-1">
            <Label className="text-xs">
              Spaces <span className="text-muted-foreground">(leave empty = all your spaces)</span>
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {mySpaces.data.map((s) => {
                const key = `${s.type}:${s.id}`;
                const selected = selectedSpaceKeys.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleSpace(key)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                      selected
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-muted bg-background text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Optional: restrict to tags */}
        <div className="space-y-1">
          <Label htmlFor="token-tags" className="text-xs">
            Tags <span className="text-muted-foreground">(comma-separated, leave empty = all tags)</span>
          </Label>
          <Input
            id="token-tags"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="coding, review"
            className="h-8 text-sm"
          />
        </div>

        <Button type="submit" size="sm" disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Generate token"}
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
                    <span className="text-muted-foreground/70">{scopeSummary(t.scope)}</span>
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
