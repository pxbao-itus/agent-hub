"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { X, GripVertical } from "lucide-react";

type Props =
  | { mode: "create" }
  | {
      mode: "edit";
      workflowId: string;
      initial: { name: string; description: string | null; projectId: string | null };
    };

// A starting point for the stage list, not a fixed vocabulary — every field
// stays editable/removable before submit, and stages can be added/renamed/
// reordered after creation too (via the pipeline view).
const DEFAULT_STAGES = ["Spec", "Design", "Build", "Review", "Done"];

export function WorkflowForm(props: Props) {
  const router = useRouter();
  const [name, setName] = useState(props.mode === "edit" ? props.initial.name : "");
  const [description, setDescription] = useState(
    props.mode === "edit" ? (props.initial.description ?? "") : "",
  );
  const [selectedSpaceKey, setSelectedSpaceKey] = useState("");
  const [projectId, setProjectId] = useState(props.mode === "edit" ? (props.initial.projectId ?? "") : "");
  const [stages, setStages] = useState<string[]>(props.mode === "create" ? DEFAULT_STAGES : []);
  const [stageInput, setStageInput] = useState("");

  const mySpaces = trpc.org.mySpaces.useQuery(undefined, { enabled: props.mode === "create" });
  const projects = trpc.project.list.useQuery();

  const create = trpc.workflow.create.useMutation({
    onSuccess: (w) => {
      toast({ title: "Workflow created", variant: "success" });
      router.push(`/workflows/${w.id}`);
    },
    onError: (e) => toast({ title: "Failed to create", description: e.message, variant: "destructive" }),
  });
  const update = trpc.workflow.update.useMutation({
    onSuccess: (w) => {
      toast({ title: "Workflow saved", variant: "success" });
      router.push(`/workflows/${w!.id}`);
    },
    onError: (e) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

  const isPending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  function addStageField() {
    const value = stageInput.trim();
    if (!value) return;
    setStages([...stages, value]);
    setStageInput("");
  }
  function removeStageField(i: number) {
    setStages(stages.filter((_, idx) => idx !== i));
  }
  function moveStageField(i: number, direction: -1 | 1) {
    const target = i + direction;
    if (target < 0 || target >= stages.length) return;
    const updated = [...stages];
    [updated[i], updated[target]] = [updated[target], updated[i]];
    setStages(updated);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (props.mode === "create") {
      const [ownerGroupType, ownerGroupId] = selectedSpaceKey.split(":");
      create.mutate({
        ownerGroupType: ownerGroupType as "org" | "department" | "team",
        ownerGroupId,
        name,
        description: description || undefined,
        projectId: projectId || undefined,
        stages,
      });
    } else {
      update.mutate({
        id: props.workflowId,
        name,
        description: description || null,
        projectId: projectId || null,
      });
    }
  }

  const groupUnresolved = props.mode === "create" && !selectedSpaceKey;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      <div className="space-y-2">
        <Label htmlFor="workflow-name">Name</Label>
        <Input
          id="workflow-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Session bug fix process"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="workflow-description">Description <span className="text-muted-foreground">(optional)</span></Label>
        <Input
          id="workflow-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this process is for"
        />
      </div>

      {props.mode === "create" && (
        <div className="space-y-2">
          <Label>Owning group</Label>
          {mySpaces.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading groups…</p>
          ) : (
            <Select value={selectedSpaceKey} onValueChange={setSelectedSpaceKey}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select org/department/team" /></SelectTrigger>
              <SelectContent>
                {mySpaces.data?.map((s) => (
                  <SelectItem key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>
                    {s.slugPath || s.name} <span className="text-muted-foreground capitalize">({s.type})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
      {props.mode === "edit" && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Owning group cannot be changed after creation.
        </div>
      )}

      <div className="space-y-2">
        <Label>Project <span className="text-muted-foreground">(optional)</span></Label>
        <Select value={projectId || "__none"} onValueChange={(v) => setProjectId(v === "__none" ? "" : v)}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Not linked to a project" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">Not linked to a project</SelectItem>
            {projects.data?.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Purely organizational — a workflow can be a standalone recurring process or scoped to one project.
        </p>
      </div>

      {props.mode === "create" && (
        <div className="space-y-2">
          <Label>Stages</Label>
          <p className="text-xs text-muted-foreground">
            A starting point — add, rename, remove, and reorder stages any time from the workflow page.
          </p>
          <ul className="space-y-1.5">
            {stages.map((stage, i) => (
              <li key={i} className="flex items-center gap-2">
                <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <Input
                  value={stage}
                  onChange={(e) => setStages(stages.map((s, idx) => (idx === i ? e.target.value : s)))}
                  className="h-8"
                />
                <button
                  type="button"
                  onClick={() => moveStageField(i, -1)}
                  disabled={i === 0}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label="Move stage up"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => moveStageField(i, 1)}
                  disabled={i === stages.length - 1}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label="Move stage down"
                >
                  ▼
                </button>
                <button
                  type="button"
                  onClick={() => removeStageField(i)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Remove stage"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input
              value={stageInput}
              onChange={(e) => setStageInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addStageField(); } }}
              placeholder="Add a stage…"
              className="h-8"
            />
            <Button type="button" variant="outline" size="sm" onClick={addStageField}>Add</Button>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending || groupUnresolved}>
          {isPending ? (props.mode === "create" ? "Creating…" : "Saving…") : (props.mode === "create" ? "Create workflow" : "Save changes")}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
