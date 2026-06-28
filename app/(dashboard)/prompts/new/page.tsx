import type { Metadata } from "next";
import { PromptForm } from "../_components/prompt-form";

export const metadata: Metadata = { title: "New prompt" };

type OwnerType = "org" | "department" | "team";
const VALID_OWNER_TYPES: OwnerType[] = ["org", "department", "team"];

export default async function NewPromptPage({
  searchParams,
}: {
  searchParams: Promise<{ ownerType?: string; ownerId?: string }>;
}) {
  const { ownerType, ownerId } = await searchParams;

  const preselect =
    VALID_OWNER_TYPES.includes(ownerType as OwnerType) && ownerId
      ? { ownerType: ownerType as OwnerType, ownerId }
      : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New prompt</h1>
        <p className="text-sm text-muted-foreground">Use {"{{variable}}"} in the body to add dynamic placeholders.</p>
      </div>
      <PromptForm mode="create" preselectSpace={preselect} />
    </div>
  );
}
