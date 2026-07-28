import type { HelpTopicSlug } from "@/content/help/registry";

const PREFIX_TOPICS: Array<[prefix: string, topic: HelpTopicSlug]> = [
  ["/my-work", "sharing-and-assignment"],
  ["/settings/orgs", "spaces-and-permissions"],
  ["/settings/users", "users-and-roles"],
  ["/settings/audit", "audit-log"],
  ["/settings/tokens", "connect-agent"],
  ["/prompts", "prompts"],
  ["/skills", "skills"],
  ["/docs", "docs"],
  ["/plans", "plans"],
  ["/projects", "projects"],
  ["/workflows", "workflows"],
  ["/search", "finding-content"],
  ["/explore", "finding-content"],
  ["/import", "reuse-and-portability"],
];

export function topicForPathname(pathname: string): HelpTopicSlug | null {
  if (pathname === "/") return "getting-started";
  if (pathname === "/help" || pathname.startsWith("/help/")) return null;
  return PREFIX_TOPICS.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1] ?? null;
}
