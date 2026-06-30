import type { Metadata } from "next";
import { DocForm } from "../_components/doc-form";

export const metadata: Metadata = { title: "New doc" };

export default async function NewDocPage({
  searchParams,
}: {
  searchParams: Promise<{ ownerType?: string; ownerId?: string }>;
}) {
  const { ownerType, ownerId } = await searchParams;

  const validTypes = ["org", "department", "team"] as const;
  const preselect =
    ownerType && ownerId && validTypes.includes(ownerType as (typeof validTypes)[number])
      ? { ownerType: ownerType as "org" | "department" | "team", ownerId }
      : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New doc</h1>
        <p className="text-sm text-muted-foreground">
          Capture a business requirement, bug description, or domain knowledge.
        </p>
      </div>
      <div className="max-w-2xl">
        <DocForm mode="create" preselectSpace={preselect} />
      </div>
    </div>
  );
}
