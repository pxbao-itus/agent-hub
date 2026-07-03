import type { Metadata } from "next";
import { ProjectForm } from "../_components/project-form";

export const metadata: Metadata = { title: "New project" };

export default function NewProjectPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New project</h1>
        <p className="text-sm text-muted-foreground">
          Group docs and plans that belong together, with a shared member list.
        </p>
      </div>
      <div className="max-w-2xl">
        <ProjectForm mode="create" />
      </div>
    </div>
  );
}
