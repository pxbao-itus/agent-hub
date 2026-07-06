"use client";

import { trpc } from "@/lib/trpc/client";
import { toast } from "@/hooks/use-toast";

type Status = "todo" | "doing" | "done";

const STATUS_CYCLE: Record<Status, Status> = {
  todo: "doing",
  doing: "done",
  done: "todo",
};

const STATUS_LABEL: Record<Status, string> = {
  todo: "[ ]",
  doing: "[~]",
  done: "[x]",
};

const STATUS_CLASS: Record<Status, string> = {
  todo: "text-muted-foreground",
  doing: "text-yellow-600 dark:text-yellow-400",
  done: "text-green-600 dark:text-green-400",
};

type Props = {
  stageId: string;
  status: Status;
  onUpdated?: (stageId: string, newStatus: Status) => void;
};

export function StageStatusButton({ stageId, status, onUpdated }: Props) {
  const update = trpc.workflow.setStageStatus.useMutation({
    onSuccess: ({ id, status: s }) => {
      onUpdated?.(id, s as Status);
    },
    onError: (e) => toast({ title: "Failed to update", description: e.message, variant: "destructive" }),
  });

  const next = STATUS_CYCLE[status];

  return (
    <button
      type="button"
      className={`font-mono text-sm font-bold transition-colors hover:opacity-70 ${STATUS_CLASS[status]}`}
      onClick={() => update.mutate({ stageId, status: next })}
      disabled={update.isPending}
      title={`Mark as ${next}`}
    >
      {STATUS_LABEL[status]}
    </button>
  );
}
