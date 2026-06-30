"use client";

import { useState } from "react";
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

export function PlanTaskList({ tasks: initial, canEdit }: { tasks: Task[]; canEdit: boolean }) {
  const [tasks, setTasks] = useState(initial);

  function handleUpdated(taskId: string, newStatus: Status) {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)),
    );
  }

  return (
    <ul className="divide-y rounded-md border">
      {tasks.map((task) => (
        <li key={task.id} className="flex items-start gap-3 px-4 py-2.5">
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
