"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { StageStatusButton } from "./stage-status-button";
import { AttachStageArtifactDialog } from "./attach-stage-artifact-dialog";
import { EditWorkflowStageDialog } from "./edit-workflow-stage-dialog";
import { KIND_ICON, kindRoute } from "@/lib/kind";
import { MarkdownView } from "@/components/ui/markdown";
import { ChevronUp, ChevronDown, Trash2, Plus, FileText, CalendarDays, UserRound } from "lucide-react";

type StageArtifact = { id: string; kind: string; title: string; description: string | null };
type Stage = {
  id: string;
  name: string;
  description: string | null;
  acceptanceCriteria: string | null;
  assigneeId: string | null;
  assignee: { id: string; name: string | null; username: string | null; image: string | null } | null;
  dueDate: string | null;
  position: number;
  status: "todo" | "doing" | "done";
  canUpdateStatus: boolean;
  artifacts: StageArtifact[];
};

type Props = {
  workflowId: string;
  canManage: boolean;
  initialStages: Stage[];
};

export function WorkflowPipeline({ workflowId, canManage, initialStages }: Props) {
  const utils = trpc.useUtils();
  const [newStageName, setNewStageName] = useState("");
  const { data } = trpc.workflow.get.useQuery(
    { id: workflowId },
    { initialData: { stages: initialStages, canManage } as never, refetchOnMount: false },
  );
  const stages = data?.stages ?? initialStages;

  function invalidate() {
    void Promise.all([
      utils.workflow.get.invalidate({ id: workflowId }),
      utils.workflow.activity.invalidate({ workflowId }),
      utils.workflow.listMyStages.invalidate(),
    ]);
  }

  const reorder = trpc.workflow.reorderStages.useMutation({
    onSuccess: invalidate,
    onError: (e) => toast({ title: "Failed to reorder", description: e.message, variant: "destructive" }),
  });
  const removeStage = trpc.workflow.removeStage.useMutation({
    onSuccess: () => { invalidate(); toast({ title: "Stage removed", variant: "success" }); },
    onError: (e) => toast({ title: "Failed to remove stage", description: e.message, variant: "destructive" }),
  });
  const addStage = trpc.workflow.addStage.useMutation({
    onSuccess: () => { invalidate(); setNewStageName(""); },
    onError: (e) => toast({ title: "Failed to add stage", description: e.message, variant: "destructive" }),
  });
  const detachArtifact = trpc.workflow.detachArtifact.useMutation({
    onSuccess: () => { invalidate(); toast({ title: "Detached", variant: "success" }); },
    onError: (e) => toast({ title: "Failed to detach", description: e.message, variant: "destructive" }),
  });

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= stages.length) return;
    const ids = stages.map((s) => s.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate({ workflowId, stageIds: ids });
  }

  function handleAddStage(e: React.FormEvent) {
    e.preventDefault();
    if (!newStageName.trim()) return;
    addStage.mutate({ workflowId, name: newStageName.trim() });
  }

  if (stages.length === 0 && !canManage) {
    return <p className="text-sm text-muted-foreground">No stages yet.</p>;
  }

  return (
    <div className="space-y-4">
      {stages.map((stage, i) => {
        const attachedIds = new Set(stage.artifacts.map((a) => a.id));
        return (
          <div key={stage.id} className="rounded-md border">
            <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
              {canManage && (
                <div className="flex shrink-0 flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0 || reorder.isPending}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="Move stage up"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === stages.length - 1 || reorder.isPending}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="Move stage down"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </div>
              )}
              <StageStatusButton stageId={stage.id} status={stage.status} canUpdate={stage.canUpdateStatus} onUpdated={invalidate} />
              <span className="flex-1 font-medium">{stage.name}</span>
              {canManage && (
                <>
                  <EditWorkflowStageDialog workflowId={workflowId} stage={stage} onUpdated={invalidate} />
                  <button
                    type="button"
                    onClick={() => removeStage.mutate({ stageId: stage.id })}
                    disabled={removeStage.isPending}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label="Remove stage"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>

            <div className="space-y-2 p-3">
              {(stage.assignee || stage.dueDate) && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {stage.assignee && (
                    <span className="inline-flex items-center gap-1">
                      <UserRound className="h-3.5 w-3.5" />
                      {stage.assignee.name ?? `@${stage.assignee.username}`}
                    </span>
                  )}
                  {stage.dueDate && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" />
                      Due {stage.dueDate}
                    </span>
                  )}
                </div>
              )}
              {stage.description && <MarkdownView className="text-sm">{stage.description}</MarkdownView>}
              {stage.acceptanceCriteria && (
                <div className="rounded-md bg-muted/40 p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Acceptance criteria</p>
                  <MarkdownView className="text-sm">{stage.acceptanceCriteria}</MarkdownView>
                </div>
              )}
              {stage.artifacts.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing attached yet.</p>
              ) : (
                <div className="divide-y rounded-md border">
                  {stage.artifacts.map((a) => {
                    const Icon = KIND_ICON[a.kind] ?? FileText;
                    return (
                      <div key={a.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors">
                        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <Link href={`${kindRoute(a.kind)}/${a.id}`} className="min-w-0 flex-1 group">
                          <p className="truncate text-sm group-hover:underline">{a.title}</p>
                        </Link>
                        <Badge variant="outline" className="shrink-0 text-[10px]">{a.kind}</Badge>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => detachArtifact.mutate({ stageId: stage.id, artifactId: a.id })}
                            disabled={detachArtifact.isPending}
                            className="shrink-0 text-muted-foreground hover:text-destructive"
                            aria-label="Detach"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {canManage && (
                <AttachStageArtifactDialog stageId={stage.id} attachedIds={attachedIds} onAttached={invalidate} />
              )}
            </div>
          </div>
        );
      })}

      {canManage && (
        <form onSubmit={handleAddStage} className="flex gap-2">
          <Input
            value={newStageName}
            onChange={(e) => setNewStageName(e.target.value)}
            placeholder="Add a stage…"
            className="h-9"
          />
          <Button type="submit" variant="outline" size="sm" disabled={addStage.isPending} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Add stage
          </Button>
        </form>
      )}
    </div>
  );
}
