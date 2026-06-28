import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  message: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  variant?: "empty" | "no-results" | "error";
  className?: string;
};

export function EmptyState({
  message,
  description,
  icon: Icon,
  action,
  variant = "empty",
  className,
}: Props) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed p-12 text-center",
        variant === "error" && "border-destructive/40 bg-destructive/5",
        className,
      )}
    >
      {Icon && (
        <Icon
          className={cn(
            "mx-auto mb-3 h-8 w-8",
            variant === "error" ? "text-destructive/60" : "text-muted-foreground/50",
          )}
          strokeWidth={1.5}
        />
      )}
      <p
        className={cn(
          "text-sm font-medium",
          variant === "error" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {message}
      </p>
      {description && (
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
