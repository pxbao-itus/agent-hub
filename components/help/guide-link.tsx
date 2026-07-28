import Link from "next/link";
import { BookOpen, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HelpTopicSlug } from "@/content/help/registry";

export function GuideLink({
  topic,
  label = "Guide",
  variant = "button",
}: {
  topic: HelpTopicSlug;
  label?: string;
  variant?: "button" | "icon";
}) {
  const accessibleLabel = `Open ${label} in a new tab`;

  return (
    <Button asChild variant="ghost" size={variant === "icon" ? "icon" : "sm"}>
      <Link
        href={`/help/${topic}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={accessibleLabel}
        title={accessibleLabel}
      >
        <BookOpen className="h-4 w-4" />
        {variant === "button" && <span>{label}</span>}
        {variant === "button" && <ExternalLink className="h-3 w-3 text-muted-foreground" aria-hidden="true" />}
      </Link>
    </Button>
  );
}
