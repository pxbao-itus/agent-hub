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
  promptId: string;
  versions: Version[];
  currentVersionId: string | null;
  canEdit: boolean;
};

export function VersionHistory({ promptId, versions, currentVersionId, canEdit }: Props) {
  const rollback = trpc.prompt.rollback.useMutation();

  return (
    <VersionHistoryView
      versions={versions}
      currentVersionId={currentVersionId}
      canEdit={canEdit}
      onRollback={(toVersionNo) => rollback.mutateAsync({ promptId, toVersionNo })}
    />
  );
}
