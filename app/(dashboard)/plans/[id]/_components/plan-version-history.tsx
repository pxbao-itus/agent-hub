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
  planId: string;
  versions: Version[];
  currentVersionId: string | null | undefined;
  canEdit: boolean;
};

export function PlanVersionHistory({ planId, versions, currentVersionId, canEdit }: Props) {
  const rollback = trpc.plan.rollback.useMutation();

  return (
    <VersionHistoryView
      versions={versions.map((v) => ({
        ...v,
        extra: (
          <p className="text-xs text-muted-foreground">
            Tasks are live and not affected by rollback.
          </p>
        ),
      }))}
      currentVersionId={currentVersionId}
      canEdit={canEdit}
      onRollback={(toVersionNo) => rollback.mutateAsync({ id: planId, toVersionNo })}
    />
  );
}
