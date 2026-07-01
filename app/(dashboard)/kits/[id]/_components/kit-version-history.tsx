"use client";

import { trpc } from "@/lib/trpc/client";
import { VersionHistoryView } from "../../../_components/version-history-view";

type Version = {
  id: string;
  versionNo: number;
  body: string;
  changelog: string | null;
  createdAt: Date;
};

type Props = {
  kitId: string;
  versions: Version[];
  currentVersionId: string | null | undefined;
  canEdit: boolean;
};

export function KitVersionHistory({ kitId, versions, currentVersionId, canEdit }: Props) {
  const rollback = trpc.kit.rollback.useMutation();

  return (
    <VersionHistoryView
      versions={versions.map((v) => ({
        ...v,
        extra: (
          <p className="text-xs text-muted-foreground">
            Members are live and not affected by rollback.
          </p>
        ),
      }))}
      currentVersionId={currentVersionId}
      canEdit={canEdit}
      onRollback={(toVersionNo) => rollback.mutateAsync({ id: kitId, toVersionNo })}
    />
  );
}
