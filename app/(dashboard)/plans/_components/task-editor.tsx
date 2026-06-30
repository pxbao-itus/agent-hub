"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, ChevronUp, ChevronDown, Plus } from "lucide-react";

export type TaskEntry = {
  id?: string;
  content: string;
  status: "todo" | "doing" | "done";
};

type Props = {
  tasks: TaskEntry[];
  onChange: (tasks: TaskEntry[]) => void;
};

const STATUS_LABELS: Record<TaskEntry["status"], string> = {
  todo: "Todo",
  doing: "Doing",
  done: "Done",
};

export function TaskEditor({ tasks, onChange }: Props) {
  function update(index: number, patch: Partial<TaskEntry>) {
    const next = tasks.map((t, i) => (i === index ? { ...t, ...patch } : t));
    onChange(next);
  }

  function remove(index: number) {
    onChange(tasks.filter((_, i) => i !== index));
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const next = [...tasks];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChange(next);
  }

  function moveDown(index: number) {
    if (index === tasks.length - 1) return;
    const next = [...tasks];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    onChange(next);
  }

  function add() {
    onChange([...tasks, { content: "", status: "todo" }]);
  }

  return (
    <div className="space-y-2">
      {tasks.map((task, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              onClick={() => moveUp(i)}
              disabled={i === 0}
              className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Move up"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => moveDown(i)}
              disabled={i === tasks.length - 1}
              className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Move down"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>

          <Input
            value={task.content}
            onChange={(e) => update(i, { content: e.target.value })}
            placeholder="Task description"
            className="flex-1 text-sm"
          />

          <Select
            value={task.status}
            onValueChange={(v) => update(i, { status: v as TaskEntry["status"] })}
          >
            <SelectTrigger className="w-[90px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["todo", "doing", "done"] as const).map((s) => (
                <SelectItem key={s} value={s} className="text-xs">
                  {STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <button
            type="button"
            onClick={() => remove(i)}
            className="text-muted-foreground hover:text-destructive"
            aria-label="Remove task"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={add} className="gap-1.5">
        <Plus className="h-3.5 w-3.5" />
        Add task
      </Button>
    </div>
  );
}
