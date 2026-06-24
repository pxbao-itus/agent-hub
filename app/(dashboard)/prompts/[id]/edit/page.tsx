import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { prompts, promptVersions } from "@/server/db/schema";
import { eq, desc } from "drizzle-orm";
import { PromptForm } from "../../_components/prompt-form";

export default async function EditPromptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  const prompt = await db.query.prompts.findFirst({
    where: eq(prompts.id, id),
    with: { versions: { orderBy: desc(promptVersions.versionNo), limit: 1 } },
  });
  if (!prompt) notFound();

  const isOwner = (prompt.ownerType === "user" && prompt.ownerId === userId) || isSuperAdmin;
  if (!isOwner) notFound();

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
          description: prompt.description,
          body: currentBody,
          tags: prompt.tags,
          visibility: prompt.visibility,
        }}
      />
    </div>
  );
}
