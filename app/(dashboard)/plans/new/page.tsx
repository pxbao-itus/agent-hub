import type { Metadata } from "next";
import { PlanForm } from "../_components/plan-form";

export const metadata: Metadata = { title: "New plan" };

export default function NewPlanPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New plan</h1>
        <p className="text-sm text-muted-foreground">
          A plan tracks progress with an overview and a task checklist. Tasks can be ticked by agents via MCP.
        </p>
      </div>
      <PlanForm mode="create" />
    </div>
  );
}
