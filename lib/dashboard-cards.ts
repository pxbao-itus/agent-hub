import type { LucideIcon } from "lucide-react";
import { BookText, Building2, ClipboardList, FileText, Key, Wrench } from "lucide-react";

export const DASHBOARD_CARD_IDS = [
  "prompts",
  "skills",
  "plans",
  "docs",
  "organizations",
  "mcp_tokens",
] as const;

export type DashboardCardId = (typeof DASHBOARD_CARD_IDS)[number];

export type DashboardCardDefinition = {
  id: DashboardCardId;
  label: string;
  href: string;
  description: string;
  icon: LucideIcon;
};

export const DASHBOARD_CARDS: Record<DashboardCardId, DashboardCardDefinition> = {
  prompts: {
    id: "prompts",
    label: "Prompts",
    href: "/prompts",
    description: "accessible to you",
    icon: BookText,
  },
  skills: {
    id: "skills",
    label: "Skills",
    href: "/skills",
    description: "accessible to you",
    icon: Wrench,
  },
  plans: {
    id: "plans",
    label: "Plans",
    href: "/plans",
    description: "accessible to you",
    icon: ClipboardList,
  },
  docs: {
    id: "docs",
    label: "Docs",
    href: "/docs",
    description: "accessible to you",
    icon: FileText,
  },
  organizations: {
    id: "organizations",
    label: "Organizations",
    href: "/settings/orgs",
    description: "you're a member of",
    icon: Building2,
  },
  mcp_tokens: {
    id: "mcp_tokens",
    label: "MCP Tokens",
    href: "/settings/tokens",
    description: "active tokens",
    icon: Key,
  },
};

export const DEFAULT_DASHBOARD_CARD_IDS: readonly DashboardCardId[] = DASHBOARD_CARD_IDS;

const dashboardCardIdSet = new Set<string>(DASHBOARD_CARD_IDS);

export function isDashboardCardId(value: string): value is DashboardCardId {
  return dashboardCardIdSet.has(value);
}

/** Missing preference means default; an explicit empty array stays empty. */
export function normalizeDashboardCardIds(
  stored: readonly string[] | null | undefined,
): DashboardCardId[] {
  if (stored == null) return [...DEFAULT_DASHBOARD_CARD_IDS];

  const seen = new Set<DashboardCardId>();
  const normalized: DashboardCardId[] = [];
  for (const id of stored) {
    if (!isDashboardCardId(id) || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

export function dashboardCardLayoutsEqual(
  left: readonly DashboardCardId[],
  right: readonly DashboardCardId[],
): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function getHiddenDashboardCardIds(
  visible: readonly DashboardCardId[],
): DashboardCardId[] {
  const visibleSet = new Set(visible);
  return DASHBOARD_CARD_IDS.filter((id) => !visibleSet.has(id));
}
