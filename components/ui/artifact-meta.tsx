import { formatRelativeTime } from "@/lib/relative-time";

type Props = {
  updatedAt: Date;
  authorName: string | null;
  versionNo?: number;
};

export function ArtifactMeta({ updatedAt, authorName, versionNo }: Props) {
  return (
    <p className="text-xs text-muted-foreground">
      Updated {formatRelativeTime(updatedAt)}
      {authorName && <> · by {authorName}</>}
      {versionNo !== undefined && <> · v{versionNo}</>}
    </p>
  );
}
