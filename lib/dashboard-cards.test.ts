import { describe, expect, it } from "vitest";
import {
  DASHBOARD_CARD_IDS,
  DASHBOARD_CARDS,
  DEFAULT_DASHBOARD_CARD_IDS,
  dashboardCardLayoutsEqual,
  getHiddenDashboardCardIds,
  normalizeDashboardCardIds,
} from "./dashboard-cards";

describe("dashboard card layout", () => {
  it("defines a unique complete default catalog", () => {
    expect(new Set(DASHBOARD_CARD_IDS).size).toBe(DASHBOARD_CARD_IDS.length);
    expect(DEFAULT_DASHBOARD_CARD_IDS).toEqual(DASHBOARD_CARD_IDS);
    expect(Object.keys(DASHBOARD_CARDS)).toEqual([...DASHBOARD_CARD_IDS]);
  });

  it("uses the default only when the preference is missing", () => {
    expect(normalizeDashboardCardIds(null)).toEqual(DASHBOARD_CARD_IDS);
    expect(normalizeDashboardCardIds(undefined)).toEqual(DASHBOARD_CARD_IDS);
    expect(normalizeDashboardCardIds([])).toEqual([]);
  });

  it("preserves supported order while removing unknown and duplicate IDs", () => {
    const stored = ["skills", "retired", "prompts", "skills", "docs"];
    expect(normalizeDashboardCardIds(stored)).toEqual(["skills", "prompts", "docs"]);
    expect(stored).toEqual(["skills", "retired", "prompts", "skills", "docs"]);
  });

  it("compares ordered layouts", () => {
    expect(dashboardCardLayoutsEqual(["prompts", "skills"], ["prompts", "skills"])).toBe(true);
    expect(dashboardCardLayoutsEqual(["prompts", "skills"], ["skills", "prompts"])).toBe(false);
    expect(dashboardCardLayoutsEqual(["prompts"], ["prompts", "skills"])).toBe(false);
  });

  it("derives hidden cards in catalog order", () => {
    expect(getHiddenDashboardCardIds(["skills", "prompts"])).toEqual([
      "plans",
      "docs",
      "organizations",
      "mcp_tokens",
    ]);
  });
});
