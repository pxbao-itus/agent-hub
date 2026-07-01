import { Skeleton } from "@/components/ui/skeleton";

/** Loading placeholder mirroring the artifact detail page layout. */
export function DetailSkeleton() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-4 w-40" />

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-3 w-48" />
        </div>
        <div className="flex shrink-0 gap-2">
          <Skeleton className="h-9 w-16" />
          <Skeleton className="h-9 w-16" />
        </div>
      </div>

      <Skeleton className="h-24 w-full rounded-md" />

      <div className="space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-40 w-full rounded-md" />
      </div>
    </div>
  );
}
