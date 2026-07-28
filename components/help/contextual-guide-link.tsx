"use client";

import { usePathname } from "next/navigation";
import { GuideLink } from "@/components/help/guide-link";
import { topicForPathname } from "@/lib/help-routes";

export function ContextualGuideLink() {
  const pathname = usePathname();
  const topic = topicForPathname(pathname);
  if (!topic) return null;

  return (
    <div className="mb-2 flex justify-end">
      <GuideLink topic={topic} />
    </div>
  );
}
