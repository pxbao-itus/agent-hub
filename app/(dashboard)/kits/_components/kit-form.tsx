"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { MemberPicker, type MemberEntry } from "./member-picker";

type Visibility = "private" | "group" | "public";
type OwnerType = "user" | "org" | "department" | "team";

type Props = {
  mode: "create";
  preselectSpace?: { ownerType: "org" | "department" | "team"; ownerId: string };
} | {
  mode: "edit";
  kitId: string;
  initial: {
    title: string;
    slug?: string | null;
    description?: string | null;
    body: string;
    tags: string[];
    visibility: Visibility;
    ownerType: OwnerType;
    ownerId: string;
    members: MemberEntry[];
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

export function KitForm(props: Props) {
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
  const [selectedSpaceKey, setSelectedSpaceKey] = useState<string>(
    preselect ? `${preselect.ownerType}:${preselect.ownerId}` : "",
  );
  const [members, setMembers] = useState<MemberEntry[]>(
    props.mode === "edit" ? props.initial.members : [],
  );

  const mySpaces = trpc.org.mySpaces.useQuery(undefined, {
    enabled: props.mode === "create" && !preselect,
  });

  useEffect(() => {
    if (props.mode !== "create") return;
    if (preselect) return;
    if (visibility !== "group") return;
    if (selectedSpaceKey) return;
    const first = mySpaces.data?.[0];
    if (first) setSelectedSpaceKey(`${first.type}:${first.id}`);
  }, [visibility, mySpaces.data, props.mode, selectedSpaceKey, preselect]);

  const isPersonalSpace =
    props.mode === "edit"
      ? props.initial.ownerType === "user"
      : visibility !== "group";

  useEffect(() => {
    if (!isPersonalSpace && visibility === "private") {
      setVisibility("group");
    }
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

  const excludeId = props.mode === "edit" ? props.kitId : undefined;
  const slugCheckEnabled =
    SLUG_RE.test(debouncedSlug) &&
    debouncedSlug.length > 0 &&
    debouncedSlug === slug &&
    (visibility !== "group" || !!selectedSpaceKey);

  const slugCheck = trpc.kit.checkSlug.useQuery(
    { slug: debouncedSlug, ownerType, ownerId, excludeId },
    { enabled: slugCheckEnabled },
  );

  const create = trpc.kit.create.useMutation({
    onSuccess: (k) => {
      toast({ title: "Kit created", variant: "success" });
      router.push(`/kits/${k.id}`);
    },
    onError: (e) => toast({ title: "Failed to create", description: e.message, variant: "destructive" }),
  });
  const update = trpc.kit.update.useMutation({
    onSuccess: (k) => {
      toast({ title: "Kit saved", variant: "success" });
      router.push(`/kits/${k.id}`);
    },
    onError: (e) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

  const isPending = create.isPending || update.isPending;
  const error = create.error ?? update.error;
  const groupUnresolved =
    props.mode === "create" && visibility === "group" && !selectedSpaceKey;

  function parseTags(raw: string) {
    return raw.split(",").map((t) => t.trim()).filter(Boolean);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const tags = parseTags(tagInput);
    const slugVal = slug && SLUG_RE.test(slug) ? slug : undefined;
    const memberInput = members.map((m, i) => ({ memberArtifactId: m.memberArtifactId, position: i }));

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
        members: memberInput,
      });
    } else {
      update.mutate({
        id: props.kitId,
        title,
        slug: slugVal ?? null,
        description: description || undefined,
        body,
        tags,
        visibility,
        changelog: changelog || undefined,
        members: memberInput,
      });
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
    taken: <span className="text-xs text-destructive">✗ Already taken — choose a different slug</span>,
  }[slugStatus];

  const slugPrefix = slugPath ? `${slugPath}.` : "";

  const excludeKitId = props.mode === "edit" ? props.kitId : undefined;

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
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="My kit"
        />
      </div>

      {/* Slug */}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="slug">
            Slug <span className="text-muted-foreground font-normal">(MCP command name)</span>
          </Label>
          {slugTouched && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground underline"
              onClick={() => { setSlugTouched(false); setSlug(clientSlugify(title)); }}
            >
              Reset
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {slugPrefix && (
            <span className="shrink-0 text-sm text-muted-foreground font-mono">{slugPrefix}</span>
          )}
          <Input
            id="slug"
            value={slug}
            onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
            placeholder="my-kit"
            className="font-mono"
          />
        </div>
        {slugStatusEl}
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this kit do?"
        />
      </div>

      {/* Visibility + Space */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Visibility</Label>
          <Select value={visibility} onValueChange={(v) => setVisibility(v as Visibility)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {isPersonalSpace && <SelectItem value="private">Private</SelectItem>}
              <SelectItem value="group">Group</SelectItem>
              <SelectItem value="public">Public</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {props.mode === "create" && visibility === "group" && !preselect && (
          <div className="space-y-2">
            <Label>Space</Label>
            <Select value={selectedSpaceKey} onValueChange={setSelectedSpaceKey}>
              <SelectTrigger>
                <SelectValue placeholder="Select a space…" />
              </SelectTrigger>
              <SelectContent>
                {mySpaces.data?.map((s) => (
                  <SelectItem key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>
                    {s.name}
                    <span className="ml-1 text-xs text-muted-foreground capitalize">({s.type})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="tags">Tags</Label>
        <Input
          id="tags"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          placeholder="code, python, review (comma-separated)"
        />
      </div>

      {/* Overview body */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="body">Overview</Label>
          <span className="text-xs text-muted-foreground">Markdown supported</span>
        </div>
        <Textarea
          id="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          rows={8}
          placeholder="# My Kit&#10;&#10;Describe what this kit is for and how to use its members..."
          className="font-mono text-sm resize-y"
        />
      </div>

      {/* Members */}
      <div className="space-y-2">
        <div>
          <Label>Members</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Add prompts, skills, or other kits. Order matters — agents receive them top-to-bottom.
          </p>
        </div>
        <MemberPicker members={members} onChange={setMembers} excludeKitId={excludeKitId} />
      </div>

      {props.mode === "edit" && (
        <div className="space-y-2">
          <Label htmlFor="changelog">Changelog note</Label>
          <Input
            id="changelog"
            value={changelog}
            onChange={(e) => setChangelog(e.target.value)}
            placeholder="What changed in this version?"
          />
        </div>
      )}

      <Button
        type="submit"
        disabled={isPending || groupUnresolved || slugStatus === "taken"}
        className="w-full sm:w-auto"
      >
        {isPending
          ? props.mode === "create"
            ? "Creating…"
            : "Saving…"
          : props.mode === "create"
          ? "Create kit"
          : "Save changes"}
      </Button>
    </form>
  );
}
