import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/relative-time";

type Props = {
  visibility: "private" | "group" | "public";
  tags: string[];
  updatedAt: Date;
  authorName: string | null;
  versionNo?: number;
  fetchCount?: number;
  lastFetchedAt?: Date | null;
};

export function ArtifactMetadataFacts({
  visibility,
  tags,
  updatedAt,
  authorName,
  versionNo,
  fetchCount,
  lastFetchedAt,
}: Props) {
  return (
    <dl className="space-y-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <dt className="text-muted-foreground">Visibility</dt>
        <dd><Badge variant="outline">{visibility}</Badge></dd>
      </div>
      {versionNo !== undefined && (
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">Current version</dt>
          <dd className="font-medium">v{versionNo}</dd>
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <dt className="text-muted-foreground">Updated</dt>
        <dd className="text-right">{formatRelativeTime(updatedAt)}</dd>
      </div>
      {authorName && (
        <div className="flex items-start justify-between gap-3">
          <dt className="text-muted-foreground">Author</dt>
          <dd className="min-w-0 truncate text-right" title={authorName}>{authorName}</dd>
        </div>
      )}
      {!!fetchCount && (
        <>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">MCP uses</dt>
            <dd>{fetchCount}</dd>
          </div>
          {lastFetchedAt && (
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted-foreground">Last used</dt>
              <dd className="text-right">{formatRelativeTime(lastFetchedAt)}</dd>
            </div>
          )}
        </>
      )}
      {tags.length > 0 && (
        <div className="space-y-2">
          <dt className="text-muted-foreground">Tags</dt>
          <dd className="flex flex-wrap gap-1">
            {tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
          </dd>
        </div>
      )}
    </dl>
  );
}
