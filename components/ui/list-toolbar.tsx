"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Debounced search + sort control shared by every list page. Search updates
 * `?q=` ~300ms after typing stops; sort updates `?sort=`. Both use
 * router.replace so they don't pollute browser history per keystroke.
 */
export function ListToolbar({
  searchPlaceholder,
  hasQuery,
  extra,
}: {
  searchPlaceholder: string;
  hasQuery: boolean;
  extra?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const urlQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);

  // Resync when `q` changes from outside this input (e.g. back/forward nav).
  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    if (query === urlQuery) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (query) params.set("q", query);
      else params.delete("q");
      params.delete("offset");
      startTransition(() => router.replace(`${pathname}?${params.toString()}`));
    }, 300);
    return () => clearTimeout(t);
  }, [query, urlQuery, searchParams, pathname, router, startTransition]);

  const defaultSort = hasQuery ? "relevant" : "recent";
  const rawSort = searchParams.get("sort") ?? defaultSort;
  // "relevant" is only a valid option while searching — guard against a stale/hand-typed URL.
  const sort = !hasQuery && rawSort === "relevant" ? "recent" : rawSort;

  function setSort(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === defaultSort) params.delete("sort");
    else params.set("sort", next);
    params.delete("offset");
    startTransition(() => router.replace(`${pathname}?${params.toString()}`));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className={cn("max-w-sm transition-opacity", isPending && "opacity-70")}
        />
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="h-10 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {hasQuery && <SelectItem value="relevant">Relevant</SelectItem>}
            <SelectItem value="recent">Recent</SelectItem>
            <SelectItem value="title">A–Z</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {extra}
    </div>
  );
}
