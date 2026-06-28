import { notFound } from "next/navigation";
import { cache } from "react";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { artifacts, artifactVersions } from "@/server/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { canMutatePrompt } from "@/server/auth/access";
import { PromptForm } from "../../_components/prompt-form";

const getPromptForEdit = cache(async (id: string) =>
  db.query.artifacts.findFirst({
    where: and(eq(artifacts.id, id), eq(artifacts.kind, "prompt")),
    with: { versions: { orderBy: desc(artifactVersions.versionNo), limit: 1 } },
  }),
);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const prompt = await getPromptForEdit(id);
  return { title: prompt ? `Edit · ${prompt.title}` : "Edit prompt" };
}

export default async function EditPromptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  const prompt = await getPromptForEdit(id);
  if (!prompt) notFound();

  const canEdit = await canMutatePrompt(
    { userId, systemRole: isSuperAdmin ? "superadmin" : "user" },
    prompt,
    db,
  );
  if (!canEdit) notFound();

  const currentBody = prompt.versions[0]?.body ?? "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Edit prompt</h1>
        <p className="text-sm text-muted-foreground">Saving creates a new immutable version.</p>
      </div>
      <PromptForm
        mode="edit"
        promptId={id}
        initial={{
          title: prompt.title,
          slug: prompt.slug,
          description: prompt.description,
          body: currentBody,
          tags: prompt.tags,
          visibility: prompt.visibility,
          ownerType: prompt.ownerType as "user" | "org" | "department" | "team",
          ownerId: prompt.ownerId,
        }}
      />
    </div>
  );
}
