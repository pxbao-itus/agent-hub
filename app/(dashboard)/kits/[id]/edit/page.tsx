import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { artifacts, artifactVersions, artifactMembers } from "@/server/db/schema";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import { canMutatePrompt } from "@/server/auth/access";
import { KitForm } from "../../_components/kit-form";
import type { MemberEntry } from "../../_components/member-picker";

const getKit = cache(async (id: string) =>
  db.query.artifacts.findFirst({
    where: and(eq(artifacts.id, id), eq(artifacts.kind, "kit")),
    with: {
      versions: { orderBy: desc(artifactVersions.versionNo), limit: 1 },
      members: { orderBy: asc(artifactMembers.position) },
    },
  }),
);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const kit = await getKit(id);
  return { title: kit ? `Edit ${kit.title}` : "Edit kit" };
}

export default async function EditKitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  const kit = await getKit(id);
  if (!kit) notFound();

  const canEdit = await canMutatePrompt(
    { userId, systemRole: isSuperAdmin ? "superadmin" : "user" },
    kit,
    db,
  );
  if (!canEdit) redirect(`/kits/${id}`);

  const currentVersion = kit.versions[0];

  // Resolve member artifact details for the form
  const memberIds = kit.members.map((m) => m.memberArtifactId);
  const memberArtifacts =
    memberIds.length > 0
      ? await db.query.artifacts.findMany({
          where: inArray(artifacts.id, memberIds),
          columns: { id: true, kind: true, title: true, slug: true, description: true },
        })
      : [];
  const memberById = new Map(memberArtifacts.map((a) => [a.id, a]));

  const members: MemberEntry[] = kit.members.map((m) => {
    const artifact = memberById.get(m.memberArtifactId);
    return {
      memberArtifactId: m.memberArtifactId,
      position: m.position,
      title: artifact?.title ?? m.memberArtifactId,
      kind: artifact?.kind ?? "prompt",
      slug: artifact?.slug ?? null,
      description: null,
    };
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Edit kit</h1>
        <p className="text-sm text-muted-foreground">{kit.title}</p>
      </div>
      <KitForm
        mode="edit"
        kitId={id}
        initial={{
          title: kit.title,
          slug: kit.slug,
          description: kit.description,
          body: currentVersion?.body ?? "",
          tags: kit.tags,
          visibility: kit.visibility as "private" | "group" | "public",
          ownerType: kit.ownerType as "user" | "org" | "department" | "team",
          ownerId: kit.ownerId,
          members,
        }}
      />
    </div>
  );
}
