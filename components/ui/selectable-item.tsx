"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { useListSelection } from "@/components/ui/list-selection-context";
import { cn } from "@/lib/utils";

/**
 * Wraps a single list-page card (still server-rendered, passed as children)
 * with a selection checkbox overlaid in the corner. The checkbox is a DOM
 * sibling of the card's own <Link>, not a descendant, so clicking it never
 * triggers navigation regardless of visual overlap.
 */
export function SelectableItem({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  const { isSelected, toggle, pendingDelete } = useListSelection();
  const isPending = pendingDelete.has(id);

  return (
    <div className={cn("relative", isPending && "pointer-events-none opacity-40 transition-opacity")}>
      <div className="absolute left-2 top-2 z-10">
        <Checkbox
          checked={isSelected(id)}
          onCheckedChange={() => toggle(id)}
          disabled={isPending}
          aria-label={`Select ${label}`}
          className="border-muted-foreground/50 bg-background shadow-sm"
        />
      </div>
      {children}
    </div>
  );
}
