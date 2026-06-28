import type { Metadata } from "next";
import { SkillForm } from "../_components/skill-form";

export const metadata: Metadata = { title: "New skill" };

export default function NewSkillPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New skill</h1>
        <p className="text-sm text-muted-foreground">
          A skill is a reusable instruction set with optional bundled files.
        </p>
      </div>
      <SkillForm mode="create" />
    </div>
  );
}
