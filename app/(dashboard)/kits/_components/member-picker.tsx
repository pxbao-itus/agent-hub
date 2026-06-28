"use client";

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, X, ChevronUp, ChevronDown, BookText, Wrench, Package } from "lucide-react";

export type MemberEntry = {
  memberArtifactId: string;
  position: number;
  title: string;
  kind: string;
  slug: string | null;
  description: string | null;
};

const KIND_ICON: Record<string, React.ElementType> = {
  prompt: BookText,
  skill: Wrench,
  kit: Package,
};

const KIND_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  prompt: "default",
  skill: "secondary",
  kit: "outline",
};

type Props = {
  members: MemberEntry[];
  onChange: (members: MemberEntry[]) => void;
  excludeKitId?: string;
};

export function MemberPicker({ members, onChange, excludeKitId }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const selectedIds = new Set(members.map((m) => m.memberArtifactId));

  const { data: results = [], isFetching } = trpc.kit.listAddable.useQuery(
    { query: debouncedQuery || undefined, excludeKitId, limit: 20 },
    { staleTime: 5_000 },
  );

  const filteredResults = results.filter((r) => !selectedIds.has(r.id));

  function addMember(artifact: typeof results[number]) {
    const newMember: MemberEntry = {
      memberArtifactId: artifact.id,
      position: members.length,
      title: artifact.title,
      kind: artifact.kind,
      slug: artifact.slug,
      description: artifact.description,
    };
    onChange([...members, newMember]);
    setOpen(false);
    setQuery("");
    setDebouncedQuery("");
  }

  function removeMember(id: string) {
    const updated = members
      .filter((m) => m.memberArtifactId !== id)
      .map((m, i) => ({ ...m, position: i }));
    onChange(updated);
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const updated = [...members];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    onChange(updated.map((m, i) => ({ ...m, position: i })));
  }

  function moveDown(index: number) {
    if (index === members.length - 1) return;
    const updated = [...members];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    onChange(updated.map((m, i) => ({ ...m, position: i })));
  }

  return (
    <div className="space-y-2">
      {/* Member list */}
      {members.length > 0 && (
        <div className="divide-y rounded-md border">
          {members.map((m, i) => {
            const Icon = KIND_ICON[m.kind] ?? Package;
            return (
              <div key={m.memberArtifactId} className="flex items-center gap-2 px-3 py-2">
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => moveUp(i)}
                    disabled={i === 0}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="Move up"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveDown(i)}
                    disabled={i === members.length - 1}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="Move down"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </div>
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.title}</p>
                  {m.description && (
                    <p className="truncate text-xs text-muted-foreground">{m.description}</p>
                  )}
                </div>
                <Badge variant={KIND_VARIANT[m.kind] ?? "outline"} className="shrink-0 text-[10px]">
                  {m.kind}
                </Badge>
                <button
                  type="button"
                  onClick={() => removeMember(m.memberArtifactId)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label="Remove"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add member popover */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add member
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search prompts, skills, kits…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              {isFetching && <CommandEmpty>Searching…</CommandEmpty>}
              {!isFetching && filteredResults.length === 0 && (
                <CommandEmpty>
                  {selectedIds.size > 0 && results.length === selectedIds.size
                    ? "All available artifacts already added."
                    : "No results found."}
                </CommandEmpty>
              )}
              {filteredResults.length > 0 && (
                <CommandGroup>
                  {filteredResults.map((a) => {
                    const Icon = KIND_ICON[a.kind] ?? Package;
                    return (
                      <CommandItem key={a.id} value={a.id} onSelect={() => addMember(a)}>
                        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{a.title}</p>
                          {a.description && (
                            <p className="truncate text-xs text-muted-foreground">{a.description}</p>
                          )}
                        </div>
                        <Badge variant={KIND_VARIANT[a.kind] ?? "outline"} className="shrink-0 text-[10px]">
                          {a.kind}
                        </Badge>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
