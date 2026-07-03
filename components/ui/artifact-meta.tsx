import { formatRelativeTime } from "@/lib/relative-time";

type Props = {
  updatedAt: Date;
  authorName: string | null;
  versionNo?: number;
  /** Usage analytics (Phase 41) — omit both to hide entirely (e.g. never pulled via MCP yet). */
  fetchCount?: number;
  lastFetchedAt?: Date | null;
};

export function ArtifactMeta({ updatedAt, authorName, versionNo, fetchCount, lastFetchedAt }: Props) {
  return (
    <p className="text-xs text-muted-foreground">
      Updated {formatRelativeTime(updatedAt)}
      {authorName && <> · by {authorName}</>}
      {versionNo !== undefined && <> · v{versionNo}</>}
      {!!fetchCount && (
        <>
          {" · "}
          {fetchCount} MCP use{fetchCount === 1 ? "" : "s"}
          {lastFetchedAt && <> (last {formatRelativeTime(lastFetchedAt)})</>}
        </>
      )}
    </p>
  );
}
