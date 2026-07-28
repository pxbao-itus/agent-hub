"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { AlertCircle, CalendarDays, CheckCircle2, FileText, ListChecks, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { artifactDetailPath } from "@/lib/artifact-routes";
import { cn } from "@/lib/utils";
import type { AppRouter } from "@/server/trpc/routers/_app";

const VIEWS = [
  { value: "assigned_to_me", label: "Assigned to me", countKey: "assignedToMe" },
  { value: "coordinated_by_me", label: "Coordinated by me", countKey: "coordinatedByMe" },
  { value: "unassigned", label: "Unassigned", countKey: "unassigned" },
] as const;

const STATUS_LABELS = {
  open: "Open",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
} as const;

const PRIORITY_LABELS = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
} as const;

type View = (typeof VIEWS)[number]["value"];
type Status = keyof typeof STATUS_LABELS;
type Priority = keyof typeof PRIORITY_LABELS;
type ListMyWorkInput = Omit<inferRouterInputs<AppRouter>["assignment"]["listMyWork"], "cursor">;

function dueState(dueDate: string | null, status: Status) {
  if (!dueDate || status === "done") return null;
  const today = new Date();
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (dueDate < localToday) return "overdue";
  if (dueDate === localToday) return "today";
  return "upcoming";
}

export function MyWorkView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");

  const rawView = searchParams.get("view");
  const view: View = VIEWS.some((item) => item.value === rawView) ? rawView as View : "assigned_to_me";
  const kind = searchParams.get("kind");
  const rawStatus = searchParams.get("status");
  const rawPriority = searchParams.get("priority");
  const due = searchParams.get("due");
  const sort = searchParams.get("sort");
  const status = rawStatus && rawStatus in STATUS_LABELS ? rawStatus as Status : undefined;
  const priority = rawPriority && rawPriority in PRIORITY_LABELS ? rawPriority as Priority : undefined;

  function updateParam(key: string, value?: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") params.set(key, value);
    else params.delete(key);
    params.delete("cursor");
    startTransition(() => router.replace(`${pathname}?${params.toString()}`));
  }

  useEffect(() => {
    const urlQuery = searchParams.get("q") ?? "";
    if (query === urlQuery) return;
    const timer = setTimeout(() => updateParam("q", query.trim()), 300);
    return () => clearTimeout(timer);
    // `searchParams` intentionally reschedules the debounce after navigation.
  }, [query, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const input = useMemo<ListMyWorkInput>(() => ({
    view,
    kind: kind === "doc" || kind === "plan" ? kind as "doc" | "plan" : undefined,
    status: status ? [status] : undefined,
    priority: priority ? [priority] : undefined,
    due: due === "overdue" || due === "today" || due === "next_7_days" || due === "no_due_date"
      ? due as "overdue" | "today" | "next_7_days" | "no_due_date"
      : undefined,
    query: searchParams.get("q") || undefined,
    sort: sort === "priority" || sort === "updated" ? sort : "due_date",
    limit: 25,
  }), [view, kind, status, priority, due, sort, searchParams]);

  const work = trpc.assignment.listMyWork.useInfiniteQuery(input, {
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const utils = trpc.useUtils();
  const updateWorkItem = trpc.assignment.updateWorkItem.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.assignment.listMyWork.invalidate(),
        utils.assignment.get.invalidate(),
      ]);
    },
    onError: (error) => toast({ title: "Could not update status", description: error.message, variant: "destructive" }),
  });

  const items = work.data?.pages.flatMap((page) => page.items) ?? [];
  const counts = work.data?.pages[0]?.counts;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Work"
        description="Docs and Plans assigned to you or coordinated by you."
      />

      <div className="flex gap-1 overflow-x-auto border-b" role="tablist" aria-label="My Work views">
        {VIEWS.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={view === item.value}
            onClick={() => updateParam("view", item.value === "assigned_to_me" ? undefined : item.value)}
            className={cn(
              "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
              view === item.value
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
            {counts && <span className="ml-1.5 text-xs text-muted-foreground">{counts[item.countKey]}</span>}
          </button>
        ))}
      </div>

      <div className={cn("flex flex-wrap gap-2 transition-opacity", (isPending || work.isFetching) && "opacity-70")}>
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search work…"
          aria-label="Search My Work"
          className="w-full sm:max-w-xs"
        />
        <FilterSelect label="Kind" value={kind ?? "all"} onChange={(value) => updateParam("kind", value)}>
          <SelectItem value="all">All kinds</SelectItem>
          <SelectItem value="doc">Docs</SelectItem>
          <SelectItem value="plan">Plans</SelectItem>
        </FilterSelect>
        <FilterSelect label="Status" value={status ?? "all"} onChange={(value) => updateParam("status", value)}>
          <SelectItem value="all">All statuses</SelectItem>
          {Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
        </FilterSelect>
        <FilterSelect label="Priority" value={priority ?? "all"} onChange={(value) => updateParam("priority", value)}>
          <SelectItem value="all">All priorities</SelectItem>
          {Object.entries(PRIORITY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
        </FilterSelect>
        <FilterSelect label="Due" value={due ?? "all"} onChange={(value) => updateParam("due", value)}>
          <SelectItem value="all">Any due date</SelectItem>
          <SelectItem value="overdue">Overdue</SelectItem>
          <SelectItem value="today">Due today</SelectItem>
          <SelectItem value="next_7_days">Next 7 days</SelectItem>
          <SelectItem value="no_due_date">No due date</SelectItem>
        </FilterSelect>
        <FilterSelect label="Sort" value={sort ?? "due_date"} onChange={(value) => updateParam("sort", value === "due_date" ? undefined : value)}>
          <SelectItem value="due_date">Due date</SelectItem>
          <SelectItem value="priority">Priority</SelectItem>
          <SelectItem value="updated">Recently updated</SelectItem>
        </FilterSelect>
      </div>

      {work.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-20 w-full" />)}</div>
      ) : work.error ? (
        <EmptyState icon={AlertCircle} message="Could not load My Work" description={work.error.message} variant="error" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={view === "unassigned" ? CheckCircle2 : ListChecks}
          message={view === "assigned_to_me" ? "No work assigned to you" : view === "coordinated_by_me" ? "No work coordinated by you" : "All manageable work has assignees"}
          description="Try another view or clear the active filters."
        />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <div className="grid grid-cols-[minmax(0,1fr)_9rem_7rem_8rem_12rem] gap-3 bg-muted/40 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span>Work item</span><span>Status</span><span>Priority</span><span>Due</span><span>People</span>
            </div>
            {items.map((item) => (
              <WorkRow key={item.artifact.id} item={item} onStatusChange={(next) => updateWorkItem.mutate({ artifactId: item.artifact.id, status: next })} />
            ))}
          </div>
          <div className="space-y-3 md:hidden">
            {items.map((item) => (
              <WorkCard key={item.artifact.id} item={item} onStatusChange={(next) => updateWorkItem.mutate({ artifactId: item.artifact.id, status: next })} />
            ))}
          </div>
          {work.hasNextPage && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => work.fetchNextPage()} disabled={work.isFetchingNextPage}>
                {work.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" />}
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-10 w-[9.5rem]" aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}

type WorkItem = inferRouterOutputs<AppRouter>["assignment"]["listMyWork"]["items"][number];

function WorkRow({ item, onStatusChange }: { item: WorkItem; onStatusChange: (status: Status) => void }) {
  const due = dueState(item.dueDate, item.status);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_9rem_7rem_8rem_12rem] items-center gap-3 border-t px-4 py-3 text-sm">
      <ArtifactSummary item={item} />
      <StatusControl item={item} onChange={onStatusChange} />
      <PriorityBadge priority={item.priority} />
      <DueDate date={item.dueDate} state={due} />
      <People item={item} />
    </div>
  );
}

function WorkCard({ item, onStatusChange }: { item: WorkItem; onStatusChange: (status: Status) => void }) {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <ArtifactSummary item={item} />
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><p className="mb-1 text-xs text-muted-foreground">Status</p><StatusControl item={item} onChange={onStatusChange} /></div>
        <div><p className="mb-1 text-xs text-muted-foreground">Priority</p><PriorityBadge priority={item.priority} /></div>
        <div><p className="mb-1 text-xs text-muted-foreground">Due</p><DueDate date={item.dueDate} state={dueState(item.dueDate, item.status)} /></div>
        <div><p className="mb-1 text-xs text-muted-foreground">People</p><People item={item} /></div>
      </div>
    </div>
  );
}

function ArtifactSummary({ item }: { item: WorkItem }) {
  return (
    <div className="min-w-0">
      <Link href={artifactDetailPath(item.artifact.kind, item.artifact.id)} className="flex items-center gap-2 font-medium hover:underline">
        {item.artifact.kind === "doc" ? <FileText className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <span className="truncate">{item.artifact.title}</span>
      </Link>
      {item.projects.length > 0 && <p className="mt-1 truncate text-xs text-muted-foreground">{item.projects.map((project) => project.name).join(", ")}</p>}
    </div>
  );
}

function StatusControl({ item, onChange }: { item: WorkItem; onChange: (status: Status) => void }) {
  if (!item.canUpdateStatus) return <Badge variant="outline">{STATUS_LABELS[item.status]}</Badge>;
  return (
    <Select value={item.status} onValueChange={(value) => onChange(value as Status)}>
      <SelectTrigger className="h-8 w-full min-w-0" aria-label={`Status for ${item.artifact.title}`}><SelectValue /></SelectTrigger>
      <SelectContent>
        {Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function PriorityBadge({ priority }: { priority: Priority }) {
  const variant = priority === "urgent" ? "destructive" : priority === "high" ? "warning" : "secondary";
  return <Badge variant={variant}>{PRIORITY_LABELS[priority]}</Badge>;
}

function DueDate({ date, state }: { date: string | null; state: "overdue" | "today" | "upcoming" | null }) {
  if (!date) return <span className="text-muted-foreground">No date</span>;
  return (
    <span className={cn("inline-flex items-center gap-1", state === "overdue" && "font-medium text-destructive")}>
      <CalendarDays className="h-3.5 w-3.5" />
      {date}
    </span>
  );
}

function People({ item }: { item: WorkItem }) {
  const names = item.assignees.map((user) => user.name ?? user.email);
  return <span className="block truncate text-muted-foreground">{names.length ? names.join(", ") : "No assignees"}</span>;
}
