import { SkeletonCard } from "@/components/ui/skeleton";

export default function PromptsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="h-8 w-28 animate-pulse rounded-md bg-muted" />
        <div className="h-8 w-24 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="h-10 animate-pulse rounded-md bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}
