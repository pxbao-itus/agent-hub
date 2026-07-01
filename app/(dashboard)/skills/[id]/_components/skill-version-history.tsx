"use client";

import { trpc } from "@/lib/trpc/client";
import { VersionHistoryView } from "../../../_components/version-history-view";
import { FileText } from "lucide-react";

type Version = {
  id: string;
  versionNo: number;
  body: string;
  changelog: string | null;
  createdAt: Date;
  files: { id: string; path: string }[];
};

type Props = {
  skillId: string;
  versions: Version[];
  currentVersionId: string | null | undefined;
  canEdit: boolean;
};

export function SkillVersionHistory({ skillId, versions, currentVersionId, canEdit }: Props) {
  const rollback = trpc.skill.rollback.useMutation();

  return (
    <VersionHistoryView
      versions={versions.map((v) => ({
        ...v,
        extra: v.files.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              Bundled files ({v.files.length})
            </p>
            {v.files.map((f) => (
              <div key={f.id} className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
                <FileText className="h-3 w-3 shrink-0" />
                {f.path}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No bundled files in this version.</p>
        ),
      }))}
      currentVersionId={currentVersionId}
      canEdit={canEdit}
      onRollback={(toVersionNo) => rollback.mutateAsync({ id: skillId, toVersionNo })}
    />
  );
}
