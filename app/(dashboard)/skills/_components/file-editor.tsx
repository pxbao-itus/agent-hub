"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type FileEntry = { path: string; content: string };

type Props = {
  files: FileEntry[];
  onChange: (files: FileEntry[]) => void;
};

export function FileEditor({ files, onChange }: Props) {
  function updateFile(index: number, patch: Partial<FileEntry>) {
    const next = files.map((f, i) => (i === index ? { ...f, ...patch } : f));
    onChange(next);
  }

  function removeFile(index: number) {
    onChange(files.filter((_, i) => i !== index));
  }

  function addFile() {
    onChange([...files, { path: "", content: "" }]);
  }

  return (
    <div className="space-y-3">
      {files.map((file, i) => (
        <div key={i} className="rounded-md border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground mb-1 block">Path</Label>
              <Input
                placeholder="e.g. scripts/run.py"
                value={file.path}
                onChange={(e) => updateFile(i, { path: e.target.value })}
                className="font-mono text-sm h-8"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-5 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => removeFile(i)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Content</Label>
            <Textarea
              placeholder="File content..."
              value={file.content}
              onChange={(e) => updateFile(i, { content: e.target.value })}
              rows={6}
              className="font-mono text-xs resize-y"
            />
          </div>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={addFile} className="gap-1.5">
        <Plus className="h-4 w-4" />
        Add file
      </Button>
    </div>
  );
}
