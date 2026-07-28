"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserPicker, type PickedUser } from "@/components/ui/user-picker";
import { toast } from "@/hooks/use-toast";
import { UserCog, UserPlus, X } from "lucide-react";

type UserRow = { id: string; name: string | null; email: string; image: string | null };

type Props = {
  artifactId: string;
  canEdit: boolean;
};

function Avatar({ user }: { user: UserRow }) {
  const initial = ((user.name ?? user.email)[0] ?? "?").toUpperCase();
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
      {initial}
    </span>
  );
}

/**
 * Returns a `useSearch` hook (for UserPicker) scoped to users who can already
 * view this artifact — assignment never grants visibility, so offering
 * anyone else would let them pick a user who's guaranteed to be rejected on save.
 */
function useAssignableSearch(artifactId: string) {
  return function useScopedSearch(query: string) {
    return trpc.assignment.searchCandidates.useQuery(
      { artifactId, query },
      { enabled: query.length >= 2, staleTime: 10_000 },
    );
  };
}

/** Assigner + assignees for a doc/plan. Read-only chips when !canEdit. */
export function AssignmentPanel({ artifactId, canEdit }: Props) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.assignment.get.useQuery({ artifactId });
  const useScopedSearch = useAssignableSearch(artifactId);

  const [assignerPick, setAssignerPick] = useState<PickedUser | null>(null);
  const [assignerOpen, setAssignerOpen] = useState(false);
  const [assigneePick, setAssigneePick] = useState<PickedUser | null>(null);
  const [assigneeOpen, setAssigneeOpen] = useState(false);

  function invalidate() {
    utils.assignment.get.invalidate({ artifactId });
    utils.assignment.history.invalidate({ artifactId });
  }

  const setAssignerMut = trpc.assignment.setAssigner.useMutation({
    onSuccess: () => {
      setAssignerOpen(false);
      setAssignerPick(null);
      invalidate();
      toast({ title: "Assigner updated", variant: "success" });
    },
    onError: (e) => toast({ title: "Failed to set assigner", description: e.message, variant: "destructive" }),
  });

  const addAssigneeMut = trpc.assignment.addAssignee.useMutation({
    onSuccess: (result) => {
      setAssigneeOpen(false);
      setAssigneePick(null);
      invalidate();
      toast({ title: result.alreadyAssigned ? "Already an assignee" : "Assignee added", variant: "success" });
    },
    onError: (e) => toast({ title: "Failed to add assignee", description: e.message, variant: "destructive" }),
  });

  const removeAssigneeMut = trpc.assignment.removeAssignee.useMutation({
    onSuccess: () => {
      invalidate();
      toast({ title: "Assignee removed", variant: "success" });
    },
    onError: (e) => toast({ title: "Failed to remove assignee", description: e.message, variant: "destructive" }),
  });

  const assigner = data?.assigner ?? null;
  const assignees = data?.assignees ?? [];

  return (
    <div className="space-y-4">
      {/* Assigner */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Assigner:</span>
          {isLoading ? (
            <span className="text-sm text-muted-foreground">Loading…</span>
          ) : assigner ? (
            <span className="flex items-center gap-1.5">
              <Avatar user={assigner} />
              <span className="text-sm">{assigner.name ?? assigner.email}</span>
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">Unassigned</span>
          )}
        </div>
        {canEdit && (
          <Popover open={assignerOpen} onOpenChange={setAssignerOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs">
                <UserCog className="h-3 w-3" /> Change
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 space-y-2" align="end">
              <UserPicker
                value={assignerPick}
                onChange={setAssignerPick}
                useSearch={useScopedSearch}
                emptyHint="No matching users have access to this artifact yet — share it with them first."
              />
              <Button
                size="sm"
                className="w-full"
                disabled={!assignerPick || setAssignerMut.isPending}
                onClick={() => assignerPick && setAssignerMut.mutate({ artifactId, userId: assignerPick.id })}
              >
                {setAssignerMut.isPending ? "Saving…" : "Set as assigner"}
              </Button>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* Assignees */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">
            Assignees{assignees.length > 0 ? ` (${assignees.length})` : ""}
          </span>
          {canEdit && (
            <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs">
                  <UserPlus className="h-3 w-3" /> Add
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 space-y-2" align="end">
                <UserPicker
                  value={assigneePick}
                  onChange={setAssigneePick}
                  useSearch={useScopedSearch}
                  emptyHint="No matching users have access to this artifact yet — share it with them first."
                />
                <Button
                  size="sm"
                  className="w-full"
                  disabled={!assigneePick || addAssigneeMut.isPending}
                  onClick={() => assigneePick && addAssigneeMut.mutate({ artifactId, userId: assigneePick.id })}
                >
                  {addAssigneeMut.isPending ? "Adding…" : "Add assignee"}
                </Button>
              </PopoverContent>
            </Popover>
          )}
        </div>
        {!isLoading && assignees.length === 0 && (
          <p className="text-sm text-muted-foreground">No assignees yet.</p>
        )}
        {assignees.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {assignees.map((u) => (
              <span
                key={u.id}
                className="flex items-center gap-1.5 rounded-full border bg-muted/30 py-1 pl-1 pr-2 text-sm"
              >
                <Avatar user={u} />
                <span>{u.name ?? u.email}</span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => removeAssigneeMut.mutate({ artifactId, userId: u.id })}
                    disabled={removeAssigneeMut.isPending}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Remove assignee"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
