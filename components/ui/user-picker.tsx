"use client";

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc/client";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "./command";
import { Button } from "./button";
import { ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type PickedUser = { id: string; name: string | null; email: string; image: string | null };

type SearchResult = { data: PickedUser[] | undefined; isFetching: boolean };

function useDefaultSearch(query: string): SearchResult {
  return trpc.user.search.useQuery({ query }, { enabled: query.length >= 2, staleTime: 10_000 });
}

type Props = {
  value?: PickedUser | null;
  onChange: (user: PickedUser | null) => void;
  disabled?: boolean;
  /**
   * Override the search source — defaults to the platform-wide user.search
   * (used for sharing, which is how you'd grant someone access in the first
   * place). Callers whose picked user must ALREADY have some pre-existing
   * access (e.g. assignment) pass a scoped search hook instead, so the list
   * never offers someone who'd be rejected on save.
   */
  useSearch?: (query: string) => SearchResult;
  /** Shown when a search comes back empty. Defaults to a generic "No users found." */
  emptyHint?: string;
};

function UserAvatar({ user }: { user: PickedUser }) {
  const initials = ((user.name ?? user.email)[0] ?? "?").toUpperCase();
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
      {initials}
    </span>
  );
}

export function UserPicker({ value, onChange, disabled, useSearch = useDefaultSearch, emptyHint = "No users found." }: Props) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(inputValue), 300);
    return () => clearTimeout(t);
  }, [inputValue]);

  const { data: results = [], isFetching } = useSearch(debouncedQuery);

  function handleSelect(user: PickedUser) {
    onChange(user);
    setOpen(false);
    setInputValue("");
    setDebouncedQuery("");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", !value && "text-muted-foreground")}
        >
          {value ? (
            <span className="flex items-center gap-2">
              <UserAvatar user={value} />
              <span className="truncate">{value.name ?? value.email}</span>
            </span>
          ) : (
            "Search users…"
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by name or email…"
            value={inputValue}
            onValueChange={setInputValue}
          />
          <CommandList>
            {debouncedQuery.length < 2 && (
              <CommandEmpty>Type at least 2 characters to search.</CommandEmpty>
            )}
            {debouncedQuery.length >= 2 && isFetching && (
              <CommandEmpty>Searching…</CommandEmpty>
            )}
            {debouncedQuery.length >= 2 && !isFetching && results.length === 0 && (
              <CommandEmpty>{emptyHint}</CommandEmpty>
            )}
            {results.length > 0 && (
              <CommandGroup>
                {results.map((u) => (
                  <CommandItem key={u.id} value={u.id} onSelect={() => handleSelect(u)}>
                    <UserAvatar user={u} />
                    <div className="min-w-0 flex-1">
                      {u.name && <p className="truncate text-sm font-medium">{u.name}</p>}
                      <p className={cn("truncate text-xs text-muted-foreground", !u.name && "text-sm font-medium text-foreground")}>
                        {u.email}
                      </p>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
        {value && (
          <div className="border-t p-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-xs text-muted-foreground"
              onClick={() => onChange(null)}
            >
              <X className="mr-1 h-3 w-3" /> Clear selection
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
