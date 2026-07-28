"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { AssignArtifactDialog } from "./assign-artifact-dialog";
import { AddProjectMemberDialog } from "./add-project-member-dialog";
import { FileText, ClipboardList, Trash2 } from "lucide-react";

type ArtifactRow = { id: string; kind: string; title: string; description: string | null };
type MemberRow = { id: string; name: string | null; email: string; image: string | null };

type Props = {
  projectId: string;
  canManage: boolean;
  initialArtifacts: ArtifactRow[];
  initialMembers: MemberRow[];
  hideHeading?: boolean;
};
type Section = "artifacts" | "members";

const KIND_ICON: Record<string, React.ElementType> = { doc: FileText, plan: ClipboardList };
const KIND_HREF: Record<string, string> = { doc: "/docs", plan: "/plans" };

function ProjectDetailPanel({
  projectId,
  canManage,
  initialArtifacts,
  initialMembers,
  hideHeading,
  section,
}: Props & { section: Section }) {
  const utils = trpc.useUtils();
  const { data } = trpc.project.get.useQuery(
    { id: projectId },
    {
      initialData: { artifacts: initialArtifacts, members: initialMembers, canManage } as never,
      refetchOnMount: false,
    },
  );
  const artifactsList = data?.artifacts ?? initialArtifacts;
  const membersList = data?.members ?? initialMembers;

  function invalidate() {
    utils.project.get.invalidate({ id: projectId });
  }

  const unassign = trpc.project.unassignArtifact.useMutation({
    onSuccess: () => {
      invalidate();
      toast({ title: "Removed from project", variant: "success" });
    },
    onError: (e) => toast({ title: "Failed to remove", description: e.message, variant: "destructive" }),
  });
  const removeMember = trpc.project.removeMember.useMutation({
    onSuccess: () => {
      invalidate();
      toast({ title: "Member removed", variant: "success" });
    },
    onError: (e) => toast({ title: "Failed to remove member", description: e.message, variant: "destructive" }),
  });

  const assignedIds = new Set(artifactsList.map((a) => a.id));

  if (section === "artifacts") {
    return (
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Docs &amp; plans ({artifactsList.length})
          </h2>
          {canManage && (
            <AssignArtifactDialog projectId={projectId} assignedIds={assignedIds} onAssigned={invalidate} />
          )}
        </div>
        {artifactsList.length === 0 ? (
          <p className="text-sm text-muted-foreground">No docs or plans assigned yet.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {artifactsList.map((a) => {
              const Icon = KIND_ICON[a.kind] ?? FileText;
              return (
                <div key={a.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <Link href={`${KIND_HREF[a.kind] ?? "/"}/${a.id}`} className="min-w-0 flex-1 group">
                    <p className="truncate text-sm font-medium group-hover:underline">{a.title}</p>
                    {a.description && (
                      <p className="truncate text-xs text-muted-foreground">{a.description}</p>
                    )}
                  </Link>
                  <Badge variant="outline" className="shrink-0 text-[10px]">{a.kind}</Badge>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => unassign.mutate({ projectId, artifactId: a.id })}
                      disabled={unassign.isPending}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      aria-label="Remove from project"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  return (
      <section className="space-y-3">
        <div className={`flex items-center ${hideHeading ? "justify-end" : "justify-between"}`}>
          {!hideHeading && (
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Members ({membersList.length})
            </h2>
          )}
          {canManage && <AddProjectMemberDialog projectId={projectId} onAdded={invalidate} />}
        </div>
        {membersList.length === 0 ? (
          <p className="text-sm text-muted-foreground">No members yet.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {membersList.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                  {((m.name ?? m.email)[0] ?? "?").toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  {m.name && <p className="truncate text-sm font-medium">{m.name}</p>}
                  <p className={m.name ? "truncate text-xs text-muted-foreground" : "truncate text-sm font-medium"}>
                    {m.email}
                  </p>
                </div>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => removeMember.mutate({ projectId, userId: m.id })}
                    disabled={removeMember.isPending}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                    aria-label="Remove member"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
  );
}

export function ProjectArtifactsPanel(props: Props) {
  return <ProjectDetailPanel {...props} section="artifacts" />;
}

export function ProjectMembersPanel(props: Props) {
  return <ProjectDetailPanel {...props} hideHeading section="members" />;
}
