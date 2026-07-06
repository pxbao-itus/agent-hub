import type { Metadata } from "next";
import { KitForm } from "../_components/kit-form";

export const metadata: Metadata = { title: "New kit" };

type Props = {
  searchParams: Promise<{ ownerType?: string; ownerId?: string }>;
};

export default async function NewKitPage({ searchParams }: Props) {
  const { ownerType, ownerId } = await searchParams;

  const validOwnerType =
    ownerType === "org" || ownerType === "department" || ownerType === "team"
      ? ownerType
      : undefined;
  const preselectSpace =
    validOwnerType && ownerId
      ? { ownerType: validOwnerType as "org" | "department" | "team", ownerId }
      : undefined;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New kit</h1>
        <p className="text-sm text-muted-foreground">Package prompts and skills into a toolkit you can reuse across projects and workflows.</p>
      </div>
      <KitForm mode="create" preselectSpace={preselectSpace} />
    </div>
  );
}
