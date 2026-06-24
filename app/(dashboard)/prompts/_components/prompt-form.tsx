"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { parseVariables } from "@/server/lib/template";

type Visibility = "private" | "group" | "public";

type Props = {
  mode: "create";
} | {
  mode: "edit";
  promptId: string;
  initial: {
    title: string;
    description?: string | null;
    body: string;
    tags: string[];
    visibility: Visibility;
  };
};

export function PromptForm(props: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(props.mode === "edit" ? props.initial.title : "");
  const [description, setDescription] = useState(
    props.mode === "edit" ? (props.initial.description ?? "") : "",
  );
  const [body, setBody] = useState(props.mode === "edit" ? props.initial.body : "");
  const [tagInput, setTagInput] = useState(
    props.mode === "edit" ? props.initial.tags.join(", ") : "",
  );
  const [visibility, setVisibility] = useState<Visibility>(
    props.mode === "edit" ? props.initial.visibility : "private",
  );
  const [changelog, setChangelog] = useState("");

  const detectedVars = parseVariables(body);

  const create = trpc.prompt.create.useMutation({
    onSuccess: (p) => router.push(`/prompts/${p.id}`),
  });
  const update = trpc.prompt.update.useMutation({
    onSuccess: (p) => router.push(`/prompts/${p.id}`),
  });

  const isPending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  function parseTags(raw: string) {
    return raw.split(",").map((t) => t.trim()).filter(Boolean);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const tags = parseTags(tagInput);
    if (props.mode === "create") {
      create.mutate({ title, description: description || undefined, body, tags, visibility, changelog: changelog || undefined });
    } else {
      update.mutate({ id: props.promptId, title, description: description || undefined, body, tags, visibility, changelog: changelog || undefined });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="My awesome prompt" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description <span className="text-muted-foreground">(optional)</span></Label>
        <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this prompt does" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="body">
          Prompt body
          <span className="ml-2 text-xs text-muted-foreground">Use {"{{variable}}"} for placeholders</span>
        </Label>
        <Textarea
          id="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          rows={10}
          className="font-mono text-sm"
          placeholder={"You are a helpful assistant.\n\nTask: {{task}}\nContext: {{context}}"}
        />
        {detectedVars.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Detected variables:</span>
            {detectedVars.map((v) => (
              <Badge key={v} variant="secondary">{"{{" + v + "}}"}</Badge>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="tags">Tags <span className="text-muted-foreground">(comma-separated)</span></Label>
          <Input id="tags" value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="coding, review, english" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="visibility">Visibility</Label>
          <select
            id="visibility"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as Visibility)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="private">Private — only me</option>
            <option value="group">Group — my org members</option>
            <option value="public">Public — everyone</option>
          </select>
        </div>
      </div>

      {props.mode === "edit" && (
        <div className="space-y-2">
          <Label htmlFor="changelog">Changelog <span className="text-muted-foreground">(optional)</span></Label>
          <Input id="changelog" value={changelog} onChange={(e) => setChangelog(e.target.value)} placeholder="What changed in this version" />
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : props.mode === "create" ? "Create prompt" : "Save new version"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
