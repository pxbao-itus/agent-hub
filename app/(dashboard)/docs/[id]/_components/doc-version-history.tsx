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
  docId: string;
  versions: Version[];
  currentVersionId: string | null | undefined;
  canEdit: boolean;
};

export function DocVersionHistory({ docId, versions, currentVersionId, canEdit }: Props) {
  const rollback = trpc.doc.rollback.useMutation();

  return (
    <VersionHistoryView
      versions={versions}
      currentVersionId={currentVersionId}
      canEdit={canEdit}
      onRollback={(toVersionNo) => rollback.mutateAsync({ id: docId, toVersionNo })}
    />
  );
}
