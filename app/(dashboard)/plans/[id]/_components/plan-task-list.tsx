"use client";

import { useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { toast } from "@/hooks/use-toast";
import { TaskStatusButton } from "../../_components/task-status-button";

type Status = "todo" | "doing" | "done";

type Task = {
  id: string;
  content: string;
  status: Status;
};

const STATUS_LABEL: Record<Status, string> = {
  todo: "todo",
  doing: "in progress",
  done: "done",
};

const CONTENT_CLASS: Record<Status, string> = {
  todo: "",
  doing: "text-yellow-700 dark:text-yellow-300",
  done: "line-through text-muted-foreground",
};

export function PlanTaskList({ planId, tasks: initial, canEdit }: { planId: string; tasks: Task[]; canEdit: boolean }) {
  const [tasks, setTasks] = useState(initial);
  const reorder = trpc.plan.reorderTasks.useMutation();

  function handleUpdated(taskId: string, newStatus: Status) {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)),
    );
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= tasks.length) return;
    const prevTasks = tasks;
    const updated = [...tasks];
    [updated[index], updated[target]] = [updated[target], updated[index]];
    setTasks(updated);
    reorder.mutate(
      { planId, taskIds: updated.map((t) => t.id) },
      { onError: (e) => { setTasks(prevTasks); toast({ title: "Failed to reorder", description: e.message, variant: "destructive" }); } },
    );
  }

  return (
    <ul className="divide-y rounded-md border">
      {tasks.map((task, i) => (
        <li key={task.id} className="flex items-start gap-3 px-4 py-2.5">
          {canEdit && (
            <div className="flex flex-col gap-0.5 pt-0.5">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0 || reorder.isPending}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                aria-label="Move up"
              >
                <ChevronUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === tasks.length - 1 || reorder.isPending}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                aria-label="Move down"
              >
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>
          )}
          {canEdit ? (
            <TaskStatusButton
              taskId={task.id}
              status={task.status}
              onUpdated={handleUpdated}
            />
          ) : (
            <span className="font-mono text-sm font-bold text-muted-foreground">
              {task.status === "done" ? "[x]" : task.status === "doing" ? "[~]" : "[ ]"}
            </span>
          )}
          <span className={`text-sm flex-1 ${CONTENT_CLASS[task.status]}`}>
            {task.content}
          </span>
          <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
            {STATUS_LABEL[task.status]}
          </span>
        </li>
      ))}
    </ul>
  );
}
