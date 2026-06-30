import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { artifacts, artifactVersions } from "@/server/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { canMutatePrompt } from "@/server/auth/access";
import { DocForm } from "../../_components/doc-form";

const getDoc = cache(async (id: string) =>
  db.query.artifacts.findFirst({
    where: and(eq(artifacts.id, id), eq(artifacts.kind, "doc")),
    with: { versions: { orderBy: desc(artifactVersions.versionNo), limit: 1 } },
  }),
);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const doc = await getDoc(id);
  return { title: doc ? `Edit: ${doc.title}` : "Edit doc" };
}

export default async function EditDocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user!.id!;
  const isSuperAdmin = session!.user!.systemRole === "superadmin";

  const doc = await getDoc(id);
  if (!doc) notFound();

  const allowed = await canMutatePrompt({ userId, systemRole: isSuperAdmin ? "superadmin" : "user" }, doc, db);
  if (!allowed) redirect(`/docs/${id}`);

  const currentVersion = doc.versions[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Edit doc</h1>
        <p className="text-sm text-muted-foreground">{doc.title}</p>
      </div>
      <div className="max-w-2xl">
        <DocForm
          mode="edit"
          docId={id}
          initial={{
            title: doc.title,
            slug: doc.slug,
            description: doc.description,
            body: currentVersion?.body ?? "",
            tags: doc.tags,
            visibility: doc.visibility as "private" | "group" | "public",
            ownerType: doc.ownerType as "user" | "org" | "department" | "team",
            ownerId: doc.ownerId,
          }}
        />
      </div>
    </div>
  );
}
