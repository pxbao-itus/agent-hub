import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

export default function ExploreLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-10 w-full max-w-sm" />
        <div className="flex gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-6 w-16 rounded-full" />)}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    </div>
  );
}
