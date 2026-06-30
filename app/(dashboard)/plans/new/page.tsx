import type { Metadata } from "next";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { artifacts } from "@/server/db/schema";
import { and, eq } from "drizzle-orm";
import { canAccessArtifact } from "@/server/auth/access";
import { PlanForm } from "../_components/plan-form";

export const metadata: Metadata = { title: "New plan" };

export default async function NewPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ ownerType?: string; ownerId?: string; linkDoc?: string }>;
}) {
  const { ownerType, ownerId, linkDoc } = await searchParams;

  const validTypes = ["org", "department", "team"] as const;
  const preselect =
    ownerType && ownerId && validTypes.includes(ownerType as (typeof validTypes)[number])
      ? { ownerType: ownerType as "org" | "department" | "team", ownerId }
      : undefined;

  // Resolve linkDoc if provided — verify user can access it
  let linkDocInfo: { id: string; title: string } | undefined;
  if (linkDoc) {
    const session = await auth();
    const userId = session!.user!.id!;
    const isSuperAdmin = session!.user!.systemRole === "superadmin";

    const doc = await db.query.artifacts.findFirst({
      where: and(eq(artifacts.id, linkDoc), eq(artifacts.kind, "doc")),
      columns: { id: true, title: true, ownerType: true, ownerId: true, visibility: true, kind: true },
    });
    if (doc) {
      const ok = await canAccessArtifact(
        { userId, systemRole: isSuperAdmin ? "superadmin" : "user" },
        doc,
        db,
      );
      if (ok) linkDocInfo = { id: doc.id, title: doc.title };
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New plan</h1>
        <p className="text-sm text-muted-foreground">
          A plan tracks progress with an overview and a task checklist.{" "}
          {linkDocInfo && (
            <span className="text-foreground font-medium">Linked to doc: {linkDocInfo.title}</span>
          )}
        </p>
      </div>
      <PlanForm mode="create" preselectSpace={preselect} linkDocId={linkDocInfo?.id} />
    </div>
  );
}
