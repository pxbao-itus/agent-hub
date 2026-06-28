import { notFound } from "next/navigation";
import { cache } from "react";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { artifacts, artifactVersions } from "@/server/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { canMutatePrompt } from "@/server/auth/access";
import { SkillForm } from "../../_components/skill-form";

const getSkillForEdit = cache(async (id: string) =>
  db.query.artifacts.findFirst({
    where: and(eq(artifacts.id, id), eq(artifacts.kind, "skill")),
    with: {
      versions: {
        orderBy: desc(artifactVersions.versionNo),
        limit: 1,
        with: { files: true },
      },
    },
  }),
);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const skill = await getSkillForEdit(id);
  return { title: skill ? `Edit · ${skill.title}` : "Edit skill" };
}

export default async function EditSkillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  const skill = await getSkillForEdit(id);
  if (!skill) notFound();

  const canEdit = await canMutatePrompt(
    { userId, systemRole: isSuperAdmin ? "superadmin" : "user" },
    skill,
    db,
  );
  if (!canEdit) notFound();

  const currentVersion = skill.versions[0];
  const currentBody = currentVersion?.body ?? "";
  const currentFiles = (currentVersion?.files ?? []).map((f) => ({
    path: f.path,
    content: f.content,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Edit skill</h1>
        <p className="text-sm text-muted-foreground">Saving creates a new immutable version.</p>
      </div>
      <SkillForm
        mode="edit"
        skillId={id}
        initial={{
          title: skill.title,
          slug: skill.slug,
          description: skill.description,
          body: currentBody,
          tags: skill.tags,
          visibility: skill.visibility,
          ownerType: skill.ownerType as "user" | "org" | "department" | "team",
          ownerId: skill.ownerId,
          files: currentFiles,
        }}
      />
    </div>
  );
}
