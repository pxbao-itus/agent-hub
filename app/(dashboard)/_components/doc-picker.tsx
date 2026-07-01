"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { FileText, Plus } from "lucide-react";

type Props = {
  sourceId: string;
  linkedIds: Set<string>;
  onAdded: () => void;
};

/** Search dialog to link an existing doc to a source artifact. */
export function AddDocLinkButton({ sourceId, linkedIds, onAdded }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const searchDocs = trpc.doc.list.useQuery(
    { query: query || undefined, limit: 10 },
    { enabled: open && query.length >= 1 },
  );

  const add = trpc.link.add.useMutation({
    onSuccess: () => {
      onAdded();
      toast({ title: "Doc linked", variant: "success" });
    },
    onError: (e) => toast({ title: "Failed to link", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Link doc
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link a doc</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search docs…"
            autoFocus
          />
          <div className="divide-y rounded-md border max-h-72 overflow-y-auto">
            {query.length < 1 && (
              <p className="px-3 py-4 text-sm text-muted-foreground text-center">Type to search docs</p>
            )}
            {searchDocs.isLoading && (
              <p className="px-3 py-4 text-sm text-muted-foreground text-center">Searching…</p>
            )}
            {searchDocs.data?.items.map((doc) => {
              const isLinked = linkedIds.has(doc.id);
              return (
                <button
                  key={doc.id}
                  type="button"
                  disabled={isLinked || add.isPending}
                  onClick={() => add.mutate({ sourceId, targetId: doc.id })}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors disabled:opacity-50"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{doc.title}</p>
                    {doc.description && (
                      <p className="text-xs text-muted-foreground truncate">{doc.description}</p>
                    )}
                  </div>
                  {isLinked && <span className="text-xs text-muted-foreground shrink-0">Linked</span>}
                </button>
              );
            })}
            {searchDocs.data?.items.length === 0 && query.length >= 1 && (
              <p className="px-3 py-4 text-sm text-muted-foreground text-center">No docs found</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
