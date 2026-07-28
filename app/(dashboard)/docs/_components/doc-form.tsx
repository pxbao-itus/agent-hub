"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

type Visibility = "private" | "group" | "public";
type OwnerType = "user" | "org" | "department" | "team";

type Props = {
  mode: "create";
  preselectSpace?: { ownerType: "org" | "department" | "team"; ownerId: string };
} | {
  mode: "edit";
  docId: string;
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

export function DocForm(props: Props) {
  const router = useRouter();

  const initialSlug = props.mode === "edit" ? (props.initial.slug ?? "") : "";
  const [title, setTitle] = useState(props.mode === "edit" ? props.initial.title : "");
  const [slug, setSlug] = useState(initialSlug);
  const [slugTouched, setSlugTouched] = useState(!!initialSlug);
  const [debouncedSlug, setDebouncedSlug] = useState(initialSlug);
  const [description, setDescription] = useState(props.mode === "edit" ? (props.initial.description ?? "") : "");
  const [body, setBody] = useState(props.mode === "edit" ? props.initial.body : "");
  const [tagInput, setTagInput] = useState(props.mode === "edit" ? props.initial.tags.join(", ") : "");
  const preselect = props.mode === "create" ? props.preselectSpace : undefined;
  const [visibility, setVisibility] = useState<Visibility>(
    props.mode === "edit" ? props.initial.visibility : preselect ? "group" : "private",
  );
  const [changelog, setChangelog] = useState("");
  const [selectedSpaceKey, setSelectedSpaceKey] = useState<string>(
    preselect ? `${preselect.ownerType}:${preselect.ownerId}` : "",
  );

  const mySpaces = trpc.org.manageableSpaces.useQuery(undefined, {
    enabled: props.mode === "create" && !preselect,
  });

  useEffect(() => {
    if (props.mode !== "create" || preselect || visibility !== "group" || selectedSpaceKey) return;
    const first = mySpaces.data?.[0];
    if (first) setSelectedSpaceKey(`${first.type}:${first.id}`);
  }, [visibility, mySpaces.data, props.mode, selectedSpaceKey, preselect]);

  const isPersonalSpace =
    props.mode === "edit" ? props.initial.ownerType === "user" : visibility !== "group";

  useEffect(() => {
    if (!isPersonalSpace && visibility === "private") setVisibility("group");
  }, [isPersonalSpace, visibility]);

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

  useEffect(() => {
    if (!slugTouched) setSlug(clientSlugify(title));
  }, [title, slugTouched]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSlug(slug), 500);
    return () => clearTimeout(t);
  }, [slug]);

  const excludeId = props.mode === "edit" ? props.docId : undefined;
  const slugCheckEnabled =
    SLUG_RE.test(debouncedSlug) &&
    debouncedSlug.length > 0 &&
    debouncedSlug === slug &&
    (visibility !== "group" || !!selectedSpaceKey);

  const slugCheck = trpc.doc.checkSlug.useQuery(
    { slug: debouncedSlug, ownerType, ownerId, excludeId },
    { enabled: slugCheckEnabled },
  );

  const create = trpc.doc.create.useMutation({
    onSuccess: (d) => { toast({ title: "Doc created", variant: "success" }); router.push(`/docs/${d.id}`); },
    onError: (e) => toast({ title: "Failed to create", description: e.message, variant: "destructive" }),
  });
  const update = trpc.doc.update.useMutation({
    onSuccess: (d) => { toast({ title: "Doc saved", variant: "success" }); router.push(`/docs/${d.id}`); },
    onError: (e) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

  const isPending = create.isPending || update.isPending;
  const error = create.error ?? update.error;
  const groupUnresolved = props.mode === "create" && visibility === "group" && !selectedSpaceKey;

  function parseTags(raw: string) {
    return raw.split(",").map((t) => t.trim()).filter(Boolean);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const tags = parseTags(tagInput);
    const slugVal = slug && SLUG_RE.test(slug) ? slug : undefined;

    if (props.mode === "create") {
      create.mutate({ title, slug: slugVal, description: description || undefined, body, tags, visibility, changelog: changelog || undefined, ownerType, ownerId });
    } else {
      update.mutate({ id: props.docId, title, slug: slugVal ?? null, description: description || undefined, body, tags, visibility, changelog: changelog || undefined });
    }
  }

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
    taken: <span className="text-xs text-destructive">✗ Already taken</span>,
  }[slugStatus];

  const slugPrefix = slugPath ? `${slugPath}.` : "";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {props.mode === "edit" && props.initial.ownerType !== "user" && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Space: <span className="font-medium text-foreground capitalize">{props.initial.ownerType}</span>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Auth bug: session expires early" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="slug">Slug <span className="text-muted-foreground">(optional)</span></Label>
        {slugPrefix && <p className="text-xs text-muted-foreground">MCP prefix: <code>{slugPrefix}</code></p>}
        <Input
          id="slug"
          value={slug}
          onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
          placeholder="auth-session-bug"
        />
        {slugStatusEl}
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description <span className="text-muted-foreground">(optional)</span></Label>
        <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short summary shown in lists and MCP" />
      </div>

      {/* Visibility */}
      <div className="space-y-2">
        <Label>Visibility</Label>
        <Select value={visibility} onValueChange={(v) => setVisibility(v as Visibility)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {isPersonalSpace && <SelectItem value="private">Private</SelectItem>}
            <SelectItem value="group">Group</SelectItem>
            <SelectItem value="public">Public</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Group space picker */}
      {props.mode === "create" && visibility === "group" && !preselect && (
        <div className="space-y-2">
          <Label>Space</Label>
          {mySpaces.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading spaces…</p>
          ) : mySpaces.error ? (
            <p className="text-sm text-destructive">Could not load manageable spaces. Try again.</p>
          ) : !mySpaces.data?.length ? (
            <p className="text-sm text-muted-foreground">You don&apos;t have permission to create group content in any space.</p>
          ) : (
            <Select value={selectedSpaceKey} onValueChange={setSelectedSpaceKey}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select a group space" /></SelectTrigger>
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
      {props.mode === "create" && preselect && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Space: <span className="font-medium text-foreground capitalize">{preselect.ownerType}</span>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="body">Content</Label>
        <MarkdownEditor id="body" value={body} onChange={setBody} rows={14} required placeholder="Markdown content — describe the bug, business requirement, or domain concept…" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="tags">Tags <span className="text-muted-foreground">(comma-separated)</span></Label>
        <Input id="tags" value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="bug, auth, billing" />
      </div>

      {props.mode === "edit" && (
        <div className="space-y-2">
          <Label htmlFor="changelog">Changelog note <span className="text-muted-foreground">(optional)</span></Label>
          <Input id="changelog" value={changelog} onChange={(e) => setChangelog(e.target.value)} placeholder="What changed?" />
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending || groupUnresolved || slugStatus === "taken"}>
          {isPending ? (props.mode === "create" ? "Creating…" : "Saving…") : (props.mode === "create" ? "Create doc" : "Save changes")}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
