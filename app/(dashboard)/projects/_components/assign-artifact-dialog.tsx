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
import { FileText, ClipboardList, Plus } from "lucide-react";

type Props = {
  projectId: string;
  assignedIds: Set<string>;
  onAssigned: () => void;
};

/** Search dialog to assign an existing doc or plan to a project. */
export function AssignArtifactDialog({ projectId, assignedIds, onAssigned }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const enabled = open && query.length >= 1;
  const docs = trpc.doc.list.useQuery({ query: query || undefined, limit: 8 }, { enabled });
  const plans = trpc.plan.list.useQuery({ query: query || undefined, limit: 8 }, { enabled });

  const assign = trpc.project.assignArtifact.useMutation({
    onSuccess: () => {
      onAssigned();
      toast({ title: "Added to project", variant: "success" });
    },
    onError: (e) => toast({ title: "Failed to add", description: e.message, variant: "destructive" }),
  });

  const results = [
    ...(docs.data?.items ?? []).map((d) => ({ ...d, kind: "doc" as const })),
    ...(plans.data?.items ?? []).map((p) => ({ ...p, kind: "plan" as const })),
  ];
  const isLoading = docs.isLoading || plans.isLoading;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add doc or plan
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a doc or plan</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search docs and plans…"
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
              const isAssigned = assignedIds.has(item.id);
              const Icon = item.kind === "doc" ? FileText : ClipboardList;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={isAssigned || assign.isPending}
                  onClick={() => assign.mutate({ projectId, artifactId: item.id })}
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
                  {isAssigned && <span className="text-xs text-muted-foreground shrink-0">Added</span>}
                </button>
              );
            })}
            {!isLoading && results.length === 0 && query.length >= 1 && (
              <p className="px-3 py-4 text-sm text-muted-foreground text-center">No docs or plans found</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
