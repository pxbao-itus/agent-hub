"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { KIND_ICON, KIND_LABEL, kindRoute } from "@/lib/kind";
import { LayoutDashboard, BookText, Wrench, ClipboardList, FileText, Compass, Search, Plus } from "lucide-react";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Prompts", href: "/prompts", icon: BookText },
  { label: "Skills", href: "/skills", icon: Wrench },
  { label: "Plans", href: "/plans", icon: ClipboardList },
  { label: "Docs", href: "/docs", icon: FileText },
  { label: "Explore", href: "/explore", icon: Compass },
  { label: "Search", href: "/search", icon: Search },
];

const CREATE_ITEMS = [
  { label: "New prompt", href: "/prompts/new", icon: BookText },
  { label: "New skill", href: "/skills/new", icon: Wrench },
  { label: "New plan", href: "/plans/new", icon: ClipboardList },
  { label: "New doc", href: "/docs/new", icon: FileText },
];

/** Global Cmd/Ctrl-K palette: jump nav, "New {kind}", and live cross-kind search. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selected, setSelected] = useState(NAV_ITEMS[0].href);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const hasQuery = query.trim().length > 0;

  const { data: results = [], isFetching } = trpc.search.quick.useQuery(
    { q: debouncedQuery },
    { enabled: open && debouncedQuery.trim().length > 0, staleTime: 5_000 },
  );

  // Keep the highlighted item pinned to the best default (top live result, or
  // the "search everything" fallback while no results have loaded yet) —
  // otherwise cmdk leaves the selection on whatever was the sole item during
  // the loading flash, even after real results appear above it.
  useEffect(() => {
    if (!open) return;
    if (!hasQuery) {
      setSelected(NAV_ITEMS[0].href);
    } else {
      setSelected(results.length > 0 ? results[0].id : `__search__${query}`);
    }
  }, [open, hasQuery, results, query]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setQuery("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg top-[20%] translate-y-0 gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command shouldFilter={false} value={selected} onValueChange={setSelected}>
          <CommandInput
            placeholder="Search artifacts, jump to a page, or create new…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {!hasQuery && (
              <>
                <CommandGroup heading="Go to">
                  {NAV_ITEMS.map((item) => (
                    <CommandItem key={item.href} value={item.href} onSelect={() => go(item.href)}>
                      <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      {item.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading="Create">
                  {CREATE_ITEMS.map((item) => (
                    <CommandItem key={item.href} value={item.href} onSelect={() => go(item.href)}>
                      <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                      {item.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {hasQuery && (
              <>
                {isFetching && <CommandEmpty>Searching…</CommandEmpty>}
                {!isFetching && results.length === 0 && <CommandEmpty>No results.</CommandEmpty>}
                {results.length > 0 && (
                  <CommandGroup heading="Artifacts">
                    {results.map((r) => {
                      const Icon = KIND_ICON[r.kind] ?? FileText;
                      return (
                        <CommandItem key={r.id} value={r.id} onSelect={() => go(`${kindRoute(r.kind)}/${r.id}`)}>
                          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="flex-1 truncate">{r.title}</span>
                          <span className="text-xs text-muted-foreground">{KIND_LABEL[r.kind]}</span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                )}
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value={`__search__${query}`}
                    onSelect={() => go(`/search?q=${encodeURIComponent(query)}`)}
                  >
                    <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                    Search everything for &quot;{query}&quot;
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
