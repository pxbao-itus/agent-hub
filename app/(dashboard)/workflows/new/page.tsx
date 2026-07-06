import type { Metadata } from "next";
import { WorkflowForm } from "../_components/workflow-form";

export const metadata: Metadata = { title: "New workflow" };

export default function NewWorkflowPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New workflow</h1>
        <p className="text-sm text-muted-foreground">
          Define the stages a process moves through — spec, build, review, and whatever fits your team.
        </p>
      </div>
      <div className="max-w-2xl">
        <WorkflowForm mode="create" />
      </div>
    </div>
  );
}
