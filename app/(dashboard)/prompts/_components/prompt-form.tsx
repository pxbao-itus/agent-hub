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
type OwnerType = "user" | "org" | "department" | "team";

type Props = {
  mode: "create";
} | {
  mode: "edit";
  promptId: string;
  initial: {
    title: string;
    slug?: string | null;
    description?: string | null;
    body: string;
    tags: string[];
    visibility: Visibility;
    ownerType: OwnerType;
    ownerId: string;
  };
};

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function clientSlugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function PromptForm(props: Props) {
  const router = useRouter();

  const initialSlug = props.mode === "edit" ? (props.initial.slug ?? "") : "";

  const [title, setTitle] = useState(props.mode === "edit" ? props.initial.title : "");
  const [slug, setSlug] = useState(initialSlug);
  const [slugTouched, setSlugTouched] = useState(!!initialSlug);
  const [debouncedSlug, setDebouncedSlug] = useState(initialSlug);
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
  // "user:" = personal space; "org:<id>" / "department:<id>" / "team:<id>" = group space
  const [selectedSpaceKey, setSelectedSpaceKey] = useState<string>("user:");

  const mySpaces = trpc.org.mySpaces.useQuery(undefined, { enabled: props.mode === "create" });

  // Derive current owner
  const ownerType: OwnerType =
    props.mode === "edit"
      ? props.initial.ownerType
      : selectedSpaceKey === "user:"
      ? "user"
      : (selectedSpaceKey.split(":")[0] as OwnerType);

  const ownerId: string | undefined =
    props.mode === "edit"
      ? props.initial.ownerId
      : selectedSpaceKey === "user:"
      ? undefined
      : selectedSpaceKey.split(":")[1];

  const slugPath =
    props.mode === "create" && selectedSpaceKey !== "user:"
      ? (mySpaces.data?.find((s) => `${s.type}:${s.id}` === selectedSpaceKey)?.slugPath ?? "")
      : "";

  // Auto-fill slug from title when user hasn't manually set one
  useEffect(() => {
    if (!slugTouched) setSlug(clientSlugify(title));
  }, [title, slugTouched]);

  // Debounce slug for the availability check
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSlug(slug), 500);
    return () => clearTimeout(t);
  }, [slug]);

  const excludeId = props.mode === "edit" ? props.promptId : undefined;
  const slugCheckEnabled = SLUG_RE.test(debouncedSlug) && debouncedSlug.length > 0 && debouncedSlug === slug;
  const slugCheck = trpc.prompt.checkSlug.useQuery(
    { slug: debouncedSlug, ownerType, ownerId, excludeId },
    { enabled: slugCheckEnabled },
  );

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
    const slugVal = slug && SLUG_RE.test(slug) ? slug : undefined;

    if (props.mode === "create") {
      create.mutate({
        title,
        slug: slugVal,
        description: description || undefined,
        body,
        tags,
        visibility,
        changelog: changelog || undefined,
        ownerType,
        ownerId,
      });
    } else {
      update.mutate({
        id: props.promptId,
        title,
        slug: slugVal ?? null,
        description: description || undefined,
        body,
        tags,
        visibility,
        changelog: changelog || undefined,
      });
    }
  }

  // Slug status
  type SlugStatus = "empty" | "invalid" | "debouncing" | "checking" | "available" | "taken";
  function getSlugStatus(): SlugStatus {
    if (!slug) return "empty";
    if (!SLUG_RE.test(slug)) return "invalid";
    if (slug !== debouncedSlug) return "debouncing";
    if (slugCheck.isLoading) return "checking";
    if (slugCheck.data?.available === true) return "available";
    if (slugCheck.data?.available === false) return "taken";
    return "debouncing";
  }
  const slugStatus = getSlugStatus();

  const slugStatusEl = {
    empty: null,
    invalid: <span className="text-xs text-destructive">Lowercase letters, numbers and hyphens only</span>,
    debouncing: <span className="text-xs text-muted-foreground">…</span>,
    checking: <span className="text-xs text-muted-foreground">Checking…</span>,
    available: <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ Available</span>,
    taken: <span className="text-xs text-destructive">✗ Already taken — choose a different slug</span>,
  }[slugStatus];

  const slugPrefix = slugPath ? `${slugPath}.` : "";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {/* Space selector — create mode only */}
      {props.mode === "create" && (
        <div className="space-y-2">
          <Label htmlFor="space">Space</Label>
          <select
            id="space"
            value={selectedSpaceKey}
            onChange={(e) => { setSelectedSpaceKey(e.target.value); setSlugTouched(false); }}
            disabled={mySpaces.isLoading}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <option value="user:">Personal space</option>
            {mySpaces.data?.map((s) => (
              <option key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>
                {s.name} ({s.slugPath})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Owner info — edit mode, non-user space */}
      {props.mode === "edit" && props.initial.ownerType !== "user" && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Space: <span className="font-medium text-foreground capitalize">{props.initial.ownerType}</span>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="My awesome prompt"
        />
      </div>

      {/* Slug */}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="slug">
            Slug <span className="text-muted-foreground font-normal">(MCP slash command name)</span>
          </Label>
          {slugTouched && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground underline"
              onClick={() => { setSlugTouched(false); setSlug(clientSlugify(title)); }}
            >
              Reset to auto
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          <span className="text-xs text-muted-foreground select-none shrink-0 font-mono whitespace-nowrap">
            /mcp__prompt-hub__{slugPrefix}
          </span>
          <Input
            id="slug"
            value={slug}
            onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
            placeholder="my-prompt"
            className="h-8 text-sm font-mono min-w-0"
          />
        </div>
        <div className="min-h-[1.25rem]">{slugStatusEl}</div>
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
        <Button type="submit" disabled={isPending || slugStatus === "taken"}>
          {isPending ? "Saving…" : props.mode === "create" ? "Create prompt" : "Save new version"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
