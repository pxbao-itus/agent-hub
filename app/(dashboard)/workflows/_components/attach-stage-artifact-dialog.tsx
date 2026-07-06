"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { KIND_ICON } from "@/lib/kind";
import { FileText, Plus } from "lucide-react";

type Props = {
  stageId: string;
  attachedIds: Set<string>;
  onAttached: () => void;
};

/**
 * Search dialog to attach any artifact kind to a workflow stage — unlike
 * project's doc/plan-only picker, a stage can hold prompt/skill/kit too
 * (that's where a kit "plugs in" to a process). Queries each kind's own
 * `.list` in parallel (small cap each), same shape as AssignArtifactDialog
 * just extended to all 5 kinds instead of 2.
 */
export function AttachStageArtifactDialog({ stageId, attachedIds, onAttached }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const enabled = open && query.length >= 1;
  const prompts = trpc.prompt.list.useQuery({ query: query || undefined, limit: 5 }, { enabled });
  const skills = trpc.skill.list.useQuery({ query: query || undefined, limit: 5 }, { enabled });
  const kits = trpc.kit.list.useQuery({ query: query || undefined, limit: 5 }, { enabled });
  const plans = trpc.plan.list.useQuery({ query: query || undefined, limit: 5 }, { enabled });
  const docs = trpc.doc.list.useQuery({ query: query || undefined, limit: 5 }, { enabled });

  const attach = trpc.workflow.attachArtifact.useMutation({
    onSuccess: () => {
      onAttached();
      toast({ title: "Attached to stage", variant: "success" });
    },
    onError: (e) => toast({ title: "Failed to attach", description: e.message, variant: "destructive" }),
  });

  const results = [
    ...(prompts.data?.items ?? []).map((a) => ({ ...a, kind: "prompt" as const })),
    ...(skills.data?.items ?? []).map((a) => ({ ...a, kind: "skill" as const })),
    ...(kits.data?.items ?? []).map((a) => ({ ...a, kind: "kit" as const })),
    ...(plans.data?.items ?? []).map((a) => ({ ...a, kind: "plan" as const })),
    ...(docs.data?.items ?? []).map((a) => ({ ...a, kind: "doc" as const })),
  ];
  const isLoading = prompts.isLoading || skills.isLoading || kits.isLoading || plans.isLoading || docs.isLoading;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Attach
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Attach to this stage</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search prompts, skills, kits, plans, docs…"
            autoFocus
          />
          <div className="divide-y rounded-md border max-h-72 overflow-y-auto">
            {query.length < 1 && (
              <p className="px-3 py-4 text-sm text-muted-foreground text-center">Type to search</p>
            )}
            {isLoading && (
              <p className="px-3 py-4 text-sm text-muted-foreground text-center">Searching…</p>
            )}
            {!isLoading && results.map((item) => {
              const isAttached = attachedIds.has(item.id);
              const Icon = KIND_ICON[item.kind] ?? FileText;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={isAttached || attach.isPending}
                  onClick={() => attach.mutate({ stageId, artifactId: item.id })}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors disabled:opacity-50"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.title}</p>
                    {item.description && (
                      <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                    )}
                  </div>
                  <Badge variant="secondary" className="shrink-0 text-[10px]">{item.kind}</Badge>
                  {isAttached && <span className="text-xs text-muted-foreground shrink-0">Attached</span>}
                </button>
              );
            })}
            {!isLoading && results.length === 0 && query.length >= 1 && (
              <p className="px-3 py-4 text-sm text-muted-foreground text-center">Nothing found</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
