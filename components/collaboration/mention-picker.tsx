"use client";

import { useEffect, useRef, useState } from "react";
import { AtSign } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export function MentionPicker({
  artifactId,
  onMention,
  disabled,
  activeQuery = null,
}: {
  artifactId: string;
  onMention: (username: string) => void;
  disabled?: boolean;
  /** Non-null while the parent textarea caret is inside an @token. */
  activeQuery?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const autoOpened = useRef(false);

  useEffect(() => {
    if (activeQuery !== null) {
      autoOpened.current = true;
      setQuery(activeQuery);
      setOpen(true);
    } else if (autoOpened.current) {
      autoOpened.current = false;
      setOpen(false);
      setQuery("");
    }
  }, [activeQuery]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 150);
    return () => clearTimeout(timer);
  }, [query]);

  const search = trpc.comment.searchMentionCandidates.useQuery(
    { artifactId, query: debounced, limit: 10 },
    { enabled: open, staleTime: 10_000 },
  );
  const users = search.data ?? [];

  function select(username: string) {
    onMention(username);
    setOpen(false);
    setQuery("");
    setDebounced("");
    autoOpened.current = false;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          <AtSign className="mr-1.5 h-3.5 w-3.5" />
          Mention
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        align="start"
        onOpenAutoFocus={(event) => {
          if (activeQuery !== null) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search username, name, or email…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {search.isFetching && <CommandEmpty>Searching…</CommandEmpty>}
            {!search.isFetching && users.length === 0 && (
              <CommandEmpty>No mentionable users found.</CommandEmpty>
            )}
            {users.length > 0 && (
              <CommandGroup>
                {users.map((user) => (
                  <CommandItem key={user.id} value={user.id} onSelect={() => select(user.username)}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{user.name ?? `@${user.username}`}</p>
                      <p className="truncate text-xs text-muted-foreground">@{user.username} · {user.email}</p>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
