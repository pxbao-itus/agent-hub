import type { Metadata } from "next";
import { ImportForm } from "./_components/import-form";

export const metadata: Metadata = { title: "Import" };

export default function ImportPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Import</h1>
        <p className="text-sm text-muted-foreground">
          Upload a bundle exported from the &quot;Export&quot; button on any prompt, skill, plan, or doc. Creates a new
          artifact in your personal space.
        </p>
      </div>
      <ImportForm />
    </div>
  );
}
