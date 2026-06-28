"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { parseVariables } from "@/server/lib/template";

type Visibility = "private" | "group" | "public";
type OwnerType = "user" | "org" | "department" | "team";

type Props = {
  mode: "create";
  preselectSpace?: { ownerType: "org" | "department" | "team"; ownerId: string };
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
  const preselect = props.mode === "create" ? props.preselectSpace : undefined;
  const [visibility, setVisibility] = useState<Visibility>(
    props.mode === "edit" ? props.initial.visibility : preselect ? "group" : "private",
  );
  const [changelog, setChangelog] = useState("");
  // Only relevant in create mode + group visibility.
  // "" = not yet selected; "org:<id>" / "department:<id>" / "team:<id>"
  const [selectedSpaceKey, setSelectedSpaceKey] = useState<string>(
    preselect ? `${preselect.ownerType}:${preselect.ownerId}` : "",
  );

  // Pre-load spaces in create mode so they're ready when user picks "Group"
  const mySpaces = trpc.org.mySpaces.useQuery(undefined, { enabled: props.mode === "create" && !preselect });

  // Auto-select first available space when user switches to group visibility (no preselect)
  useEffect(() => {
    if (props.mode !== "create") return;
    if (preselect) return; // locked to preselect
    if (visibility !== "group") return;
    if (selectedSpaceKey) return; // already chosen
    const first = mySpaces.data?.[0];
    if (first) setSelectedSpaceKey(`${first.type}:${first.id}`);
  }, [visibility, mySpaces.data, props.mode, selectedSpaceKey, preselect]);

  // Whether the current owner is a personal (user) space — drives visibility options
  const isPersonalSpace =
    props.mode === "edit"
      ? props.initial.ownerType === "user"
      : visibility !== "group";

  // When switching to a group space, reset private visibility to group
  useEffect(() => {
    if (!isPersonalSpace && visibility === "private") {
      setVisibility("group");
    }
  }, [isPersonalSpace, visibility]);

  // Derive current owner from visibility + space selection
  const ownerType: OwnerType =
    props.mode === "edit"
      ? props.initial.ownerType
      : visibility === "group" && selectedSpaceKey
      ? (selectedSpaceKey.split(":")[0] as OwnerType)
      : "user";

  const ownerId: string | undefined =
    props.mode === "edit"
      ? props.initial.ownerId
      : visibility === "group" && selectedSpaceKey
      ? selectedSpaceKey.split(":")[1]
      : undefined;

  const selectedSpace =
    props.mode === "create" && visibility === "group" && selectedSpaceKey
      ? mySpaces.data?.find((s) => `${s.type}:${s.id}` === selectedSpaceKey)
      : undefined;
  const slugPath = selectedSpace?.slugPath ?? "";

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
  const slugCheckEnabled =
    SLUG_RE.test(debouncedSlug) &&
    debouncedSlug.length > 0 &&
    debouncedSlug === slug &&
    // Don't check until space is resolved for group prompts
    (visibility !== "group" || !!selectedSpaceKey);

  const slugCheck = trpc.prompt.checkSlug.useQuery(
    { slug: debouncedSlug, ownerType, ownerId, excludeId },
    { enabled: slugCheckEnabled },
  );

  const detectedVars = parseVariables(body);

  const create = trpc.prompt.create.useMutation({
    onSuccess: (p) => {
      toast({ title: "Prompt created", variant: "success" });
      router.push(`/prompts/${p.id}`);
    },
    onError: (e) => toast({ title: "Failed to create", description: e.message, variant: "destructive" }),
  });
  const update = trpc.prompt.update.useMutation({
    onSuccess: (p) => {
      toast({ title: "Prompt saved", variant: "success" });
      router.push(`/prompts/${p.id}`);
    },
    onError: (e) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

  const isPending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  // Disable submit if group is selected but no space is resolved
  const groupUnresolved =
    props.mode === "create" && visibility === "group" && !selectedSpaceKey;

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
    available: <span className="text-xs text-success">✓ Available</span>,
    taken: <span className="text-xs text-destructive">✗ Already taken — choose a different slug</span>,
  }[slugStatus];

  const slugPrefix = slugPath ? `${slugPath}.` : "";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

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
            /mcp__agent-hub__{slugPrefix}
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

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="tags">Tags <span className="text-muted-foreground">(comma-separated)</span></Label>
            <Input id="tags" value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="coding, review, english" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="visibility">Visibility</Label>
            <Select value={visibility} onValueChange={(v) => setVisibility(v as Visibility)}>
              <SelectTrigger id="visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {isPersonalSpace && (
                  <SelectItem value="private">Private — only me</SelectItem>
                )}
                <SelectItem value="group">Group — org / team</SelectItem>
                <SelectItem value="public">Public — everyone</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Space picker — only in create mode when Group is selected */}
        {props.mode === "create" && visibility === "group" && (
          <div className="space-y-1.5">
            <Label htmlFor="space">Assign to space</Label>
            {preselect ? (
              // Locked to preselected space (from "New prompt" button in group page)
              <p className="text-sm text-muted-foreground rounded-md border px-3 py-2 bg-muted/40">
                {preselect.ownerType.charAt(0).toUpperCase() + preselect.ownerType.slice(1)}: {preselect.ownerId}
              </p>
            ) : mySpaces.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading spaces…</p>
            ) : !mySpaces.data?.length ? (
              <p className="text-xs text-destructive">
                You don&apos;t belong to any org or team yet.{" "}
                <a href="/settings/orgs" className="underline">Create one first.</a>
              </p>
            ) : (
              <Select
                value={selectedSpaceKey}
                onValueChange={(v) => { setSelectedSpaceKey(v); setSlugTouched(false); }}
              >
                <SelectTrigger id="space">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {mySpaces.data.map((s) => (
                    <SelectItem key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>
                      {s.name} — {s.slugPath}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}
      </div>

      {props.mode === "edit" && (
        <div className="space-y-2">
          <Label htmlFor="changelog">Changelog <span className="text-muted-foreground">(optional)</span></Label>
          <Input id="changelog" value={changelog} onChange={(e) => setChangelog(e.target.value)} placeholder="What changed in this version" />
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending || slugStatus === "taken" || groupUnresolved}>
          {isPending ? "Saving…" : props.mode === "create" ? "Create prompt" : "Save new version"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
