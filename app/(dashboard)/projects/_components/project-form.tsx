"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

type Props =
  | { mode: "create" }
  | {
      mode: "edit";
      projectId: string;
      initial: { name: string; description: string | null };
    };

export function ProjectForm(props: Props) {
  const router = useRouter();
  const [name, setName] = useState(props.mode === "edit" ? props.initial.name : "");
  const [description, setDescription] = useState(
    props.mode === "edit" ? (props.initial.description ?? "") : "",
  );
  const [selectedSpaceKey, setSelectedSpaceKey] = useState("");

  const mySpaces = trpc.org.manageableSpaces.useQuery(undefined, { enabled: props.mode === "create" });

  const create = trpc.project.create.useMutation({
    onSuccess: (p) => {
      toast({ title: "Project created", variant: "success" });
      router.push(`/projects/${p.id}`);
    },
    onError: (e) => toast({ title: "Failed to create", description: e.message, variant: "destructive" }),
  });
  const update = trpc.project.update.useMutation({
    onSuccess: (p) => {
      toast({ title: "Project saved", variant: "success" });
      router.push(`/projects/${p!.id}`);
    },
    onError: (e) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

  const isPending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (props.mode === "create") {
      const [ownerGroupType, ownerGroupId] = selectedSpaceKey.split(":");
      create.mutate({
        ownerGroupType: ownerGroupType as "org" | "department" | "team",
        ownerGroupId,
        name,
        description: description || undefined,
      });
    } else {
      update.mutate({ id: props.projectId, name, description: description || null });
    }
  }

  const groupUnresolved = props.mode === "create" && !selectedSpaceKey;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      <div className="space-y-2">
        <Label htmlFor="project-name">Name</Label>
        <Input
          id="project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Session bug fix"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="project-description">Description <span className="text-muted-foreground">(optional)</span></Label>
        <Input
          id="project-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this project is tracking"
        />
      </div>

      {props.mode === "create" && (
        <div className="space-y-2">
          <Label>Owning group</Label>
          {mySpaces.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading groups…</p>
          ) : mySpaces.error ? (
            <p className="text-sm text-destructive">Could not load manageable groups. Try again.</p>
          ) : !mySpaces.data?.length ? (
            <p className="text-sm text-muted-foreground">You don&apos;t have permission to create a project in any group.</p>
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
          <p className="text-xs text-muted-foreground">
            A project is purely organizational — it groups docs/plans and members, it does not change who can read them.
          </p>
        </div>
      )}

      {props.mode === "edit" && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Owning group cannot be changed after creation.
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending || groupUnresolved}>
          {isPending ? (props.mode === "create" ? "Creating…" : "Saving…") : (props.mode === "create" ? "Create project" : "Save changes")}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
