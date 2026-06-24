import { cn } from "@/lib/utils";

type Props = {
  message: string;
  action?: React.ReactNode;
  className?: string;
};

export function EmptyState({ message, action, className }: Props) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed p-12 text-center",
        className,
      )}
    >
      <p className="text-muted-foreground">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
