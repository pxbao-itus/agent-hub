"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Props = {
  allTags: string[];
};

export function SearchBar({ allTags }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const q = searchParams.get("q") ?? "";
  const activeTag = searchParams.get("tag") ?? "";

  function push(updates: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    // Reset offset on new search
    params.delete("offset");
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  return (
    <div className="space-y-3">
      <Input
        type="search"
        placeholder="Search prompts…"
        defaultValue={q}
        onChange={(e) => push({ q: e.target.value })}
        className="max-w-sm"
      />
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs text-muted-foreground self-center">Filter:</span>
          {allTags.map((tag) => (
            <button key={tag} onClick={() => push({ tag: activeTag === tag ? "" : tag })}>
              <Badge
                variant={activeTag === tag ? "default" : "outline"}
                className="cursor-pointer hover:opacity-80 transition-opacity"
              >
                {tag}
              </Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
