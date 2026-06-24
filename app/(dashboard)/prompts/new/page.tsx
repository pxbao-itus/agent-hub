import { PromptForm } from "../_components/prompt-form";

export default function NewPromptPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New prompt</h1>
        <p className="text-sm text-muted-foreground">Use {"{{variable}}"} in the body to add dynamic placeholders.</p>
      </div>
      <PromptForm mode="create" />
    </div>
  );
}
