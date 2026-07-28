"use client";

import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { toast } from "@/hooks/use-toast";

type Stage = {
  id: string;
  name: string;
  description: string | null;
  acceptanceCriteria: string | null;
  assigneeId: string | null;
  dueDate: string | null;
};

export function EditWorkflowStageDialog({
  workflowId,
  stage,
  onUpdated,
}: {
  workflowId: string;
  stage: Stage;
  onUpdated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(stage.name);
  const [description, setDescription] = useState(stage.description ?? "");
  const [criteria, setCriteria] = useState(stage.acceptanceCriteria ?? "");
  const [assigneeId, setAssigneeId] = useState(stage.assigneeId ?? "");
  const [dueDate, setDueDate] = useState(stage.dueDate ?? "");
  const candidates = trpc.workflow.searchStageAssigneeCandidates.useQuery(
    { workflowId, limit: 50 },
    { enabled: open },
  );
  const update = trpc.workflow.updateStageDetails.useMutation({
    onSuccess: () => {
      setOpen(false);
      onUpdated();
      toast({ title: "Stage updated", variant: "success" });
    },
    onError: (error) =>
      toast({ title: "Could not update stage", description: error.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (!open) return;
    setName(stage.name);
    setDescription(stage.description ?? "");
    setCriteria(stage.acceptanceCriteria ?? "");
    setAssigneeId(stage.assigneeId ?? "");
    setDueDate(stage.dueDate ?? "");
    // Reset once when the dialog opens. Depending on the stage object itself
    // would overwrite in-progress edits when the background Workflow query
    // refreshes and returns an equivalent new object.
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Edit ${stage.name}`}>
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Edit workflow stage</DialogTitle></DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor={`stage-name-${stage.id}`}>Name</Label>
            <Input id={`stage-name-${stage.id}`} value={name} onChange={(event) => setName(event.target.value)} maxLength={100} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`stage-description-${stage.id}`}>Description</Label>
            <MarkdownEditor id={`stage-description-${stage.id}`} value={description} onChange={setDescription} rows={5} placeholder="Execution context for this stage…" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`stage-criteria-${stage.id}`}>Acceptance criteria</Label>
            <MarkdownEditor id={`stage-criteria-${stage.id}`} value={criteria} onChange={setCriteria} rows={5} placeholder="What must be true before this stage is complete?" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`stage-assignee-${stage.id}`}>Responsible user</Label>
              <select
                id={`stage-assignee-${stage.id}`}
                value={assigneeId}
                onChange={(event) => setAssigneeId(event.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Unassigned</option>
                {candidates.data?.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name ?? candidate.username ?? candidate.email}
                    {candidate.username ? ` (@${candidate.username})` : ""}
                  </option>
                ))}
              </select>
              {candidates.error && <p className="text-xs text-destructive">Could not load eligible users.</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor={`stage-due-${stage.id}`}>Due date</Label>
              <Input id={`stage-due-${stage.id}`} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            type="button"
            disabled={!name.trim() || update.isPending}
            onClick={() =>
              update.mutate({
                stageId: stage.id,
                name: name.trim(),
                description: description.trim() || null,
                acceptanceCriteria: criteria.trim() || null,
                assigneeId: assigneeId || null,
                dueDate: dueDate || null,
              })
            }
          >
            Save stage
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
