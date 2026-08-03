"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, LayoutDashboard, Plus, RotateCcw, Settings2, X } from "lucide-react";
import {
  DASHBOARD_CARDS,
  DEFAULT_DASHBOARD_CARD_IDS,
  dashboardCardLayoutsEqual,
  getHiddenDashboardCardIds,
  type DashboardCardId,
} from "@/lib/dashboard-cards";
import { trpc } from "@/lib/trpc/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type DashboardCardGridProps = {
  initialLayout: DashboardCardId[];
  values: Record<DashboardCardId, number>;
};

type SortableDashboardCardProps = {
  id: DashboardCardId;
  value: number;
  disabled: boolean;
  onHide: (id: DashboardCardId) => void;
};

function CardBody({ id, value }: { id: DashboardCardId; value: number }) {
  const definition = DASHBOARD_CARDS[id];
  const Icon = definition.icon;
  return (
    <>
      <CardHeader className="flex flex-row items-center justify-between px-4 pt-4 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{definition.label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        <p className="text-3xl font-bold">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{definition.description}</p>
      </CardContent>
    </>
  );
}

function SortableDashboardCard({ id, value, disabled, onHide }: SortableDashboardCardProps) {
  const definition = DASHBOARD_CARDS[id];
  const Icon = definition.icon;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });

  return (
    <Card
      ref={setNodeRef}
      data-dashboard-card={id}
      className={cn("relative h-full", isDragging && "z-10 opacity-70 ring-2 ring-ring")}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 pt-4 pb-2">
        <CardTitle className="min-w-0 truncate text-sm font-medium text-muted-foreground">
          {definition.label}
        </CardTitle>
        <div className="flex shrink-0 items-center gap-1">
          <Icon className="mr-1 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <button
            id={`dashboard-card-handle-${id}`}
            type="button"
            data-dashboard-card-handle={id}
            aria-label={`Reorder ${definition.label}`}
            className="inline-flex h-8 w-8 touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            disabled={disabled}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`Hide ${definition.label}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            disabled={disabled}
            onClick={() => onHide(id)}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        <p className="text-3xl font-bold">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{definition.description}</p>
      </CardContent>
    </Card>
  );
}

export function DashboardCardGrid({ initialLayout, values }: DashboardCardGridProps) {
  const router = useRouter();
  const addCardTriggerRef = useRef<HTMLButtonElement>(null);
  const [savedLayout, setSavedLayout] = useState<DashboardCardId[]>(initialLayout);
  const [draftLayout, setDraftLayout] = useState<DashboardCardId[]>(initialLayout);
  const [isEditing, setIsEditing] = useState(false);
  const hiddenCardIds = useMemo(() => getHiddenDashboardCardIds(draftLayout), [draftLayout]);
  const isDirty = !dashboardCardLayoutsEqual(savedLayout, draftLayout);
  const updateLayout = trpc.dashboard.updateLayout.useMutation();
  const isSaving = updateLayout.isPending;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function enterEditMode() {
    setDraftLayout([...savedLayout]);
    setIsEditing(true);
  }

  function cancelEdit() {
    setDraftLayout([...savedLayout]);
    setIsEditing(false);
  }

  function hideCard(id: DashboardCardId) {
    const index = draftLayout.indexOf(id);
    const focusTarget = draftLayout[index + 1] ?? draftLayout[index - 1];
    setDraftLayout((current) => current.filter((cardId) => cardId !== id));
    requestAnimationFrame(() => {
      if (focusTarget) document.getElementById(`dashboard-card-handle-${focusTarget}`)?.focus();
      else addCardTriggerRef.current?.focus();
    });
  }

  function addCard(id: DashboardCardId) {
    setDraftLayout((current) => (current.includes(id) ? current : [...current, id]));
    requestAnimationFrame(() => document.getElementById(`dashboard-card-handle-${id}`)?.focus());
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setDraftLayout((current) => {
      const oldIndex = current.indexOf(active.id as DashboardCardId);
      const newIndex = current.indexOf(over.id as DashboardCardId);
      if (oldIndex < 0 || newIndex < 0) return current;
      return arrayMove(current, oldIndex, newIndex);
    });
  }

  function saveLayout() {
    updateLayout.mutate(
      { cardIds: draftLayout },
      {
        onSuccess: (layout) => {
          setSavedLayout(layout);
          setDraftLayout(layout);
          setIsEditing(false);
          toast({ title: "Dashboard cards updated" });
          router.refresh();
        },
        onError: (error) => {
          toast({
            variant: "destructive",
            title: "Could not update dashboard cards",
            description: error.message,
          });
        },
      },
    );
  }

  return (
    <section aria-labelledby="dashboard-overview-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="dashboard-overview-heading" className="flex items-center gap-2 text-lg font-semibold">
          <LayoutDashboard className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Overview
        </h2>

        {!isEditing ? (
          <Button type="button" variant="outline" size="sm" onClick={enterEditMode}>
            <Settings2 className="h-4 w-4" aria-hidden="true" />
            Customize cards
          </Button>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2" aria-label="Dashboard card controls">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  ref={addCardTriggerRef}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={hiddenCardIds.length === 0 || isSaving}
                  title={hiddenCardIds.length === 0 ? "All cards are already visible" : undefined}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add card
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {hiddenCardIds.map((id) => {
                  const definition = DASHBOARD_CARDS[id];
                  const Icon = definition.icon;
                  return (
                    <DropdownMenuItem key={id} onSelect={() => addCard(id)}>
                      <Icon className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      {definition.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isSaving || dashboardCardLayoutsEqual(draftLayout, DEFAULT_DASHBOARD_CARD_IDS)}
              onClick={() => setDraftLayout([...DEFAULT_DASHBOARD_CARD_IDS])}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reset
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={isSaving} onClick={cancelEdit}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={!isDirty || isSaving} onClick={saveLayout}>
              {isSaving ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </div>

      {isEditing ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          accessibility={{
            screenReaderInstructions: {
              draggable:
                "Press Space to pick up a dashboard card. Use arrow keys to move it, Space to drop it, or Escape to cancel.",
            },
            announcements: {
              onDragStart({ active }) {
                return `Picked up ${DASHBOARD_CARDS[active.id as DashboardCardId].label}.`;
              },
              onDragOver({ active, over }) {
                if (!over) return `${DASHBOARD_CARDS[active.id as DashboardCardId].label} is no longer over a position.`;
                const position = draftLayout.indexOf(over.id as DashboardCardId) + 1;
                return `${DASHBOARD_CARDS[active.id as DashboardCardId].label} moved to position ${position} of ${draftLayout.length}.`;
              },
              onDragEnd({ active, over }) {
                if (!over) return `${DASHBOARD_CARDS[active.id as DashboardCardId].label} was not moved.`;
                const position = draftLayout.indexOf(over.id as DashboardCardId) + 1;
                return `${DASHBOARD_CARDS[active.id as DashboardCardId].label} dropped at position ${position} of ${draftLayout.length}.`;
              },
              onDragCancel({ active }) {
                return `Moving ${DASHBOARD_CARDS[active.id as DashboardCardId].label} was cancelled.`;
              },
            },
          }}
        >
          <SortableContext items={draftLayout} strategy={rectSortingStrategy}>
            {draftLayout.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-dashboard-card-grid="edit">
                {draftLayout.map((id) => (
                  <SortableDashboardCard
                    key={id}
                    id={id}
                    value={values[id]}
                    disabled={isSaving}
                    onHide={hideCard}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center">
                <p className="font-medium">All overview cards are hidden</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Use Add card or Reset to restore cards before saving.
                </p>
              </div>
            )}
          </SortableContext>
        </DndContext>
      ) : savedLayout.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-dashboard-card-grid="view">
          {savedLayout.map((id) => {
            const definition = DASHBOARD_CARDS[id];
            return (
              <Link
                key={id}
                href={definition.href}
                data-dashboard-card={id}
                aria-label={`${definition.label}: ${values[id]} ${definition.description}`}
                className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Card className="h-full transition-colors hover:border-foreground/30 hover:bg-muted/30 hover:shadow-md">
                  <CardBody id={id} value={values[id]} />
                </Card>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="font-medium">Your overview is empty</p>
          <p className="mt-1 text-sm text-muted-foreground">Customize cards to add workspace summaries.</p>
        </div>
      )}
    </section>
  );
}
