import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getHelpTopic,
  HELP_LOCALES,
  HELP_SECTIONS,
  HELP_TOPICS,
} from "./registry";
import { topicForPathname } from "@/lib/help-routes";

const HELP_ROOT = path.join(process.cwd(), "content", "help");

describe("help content registry", () => {
  it("has unique slugs, valid sections, related topics, and review dates", () => {
    const slugs = HELP_TOPICS.map((topic) => topic.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    for (const topic of HELP_TOPICS) {
      expect(HELP_SECTIONS).toContain(topic.section);
      expect(topic.lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(topic.audience.length).toBeGreaterThan(0);
      for (const related of topic.related) {
        expect(getHelpTopic(related), `${topic.slug} links to missing topic ${related}`).toBeDefined();
      }
    }
  });

  it("has exactly one Markdown file per topic and locale with no orphan files", () => {
    const registered = [...HELP_TOPICS.map((topic) => `${topic.slug}.md`)].sort();

    for (const locale of HELP_LOCALES) {
      const actual = readdirSync(path.join(HELP_ROOT, locale))
        .filter((file) => file.endsWith(".md"))
        .sort();
      expect(actual).toEqual(registered);
    }
  });

  it("contains no broken internal help links", () => {
    const internalLink = /\]\(\/help\/([a-z0-9-]+)(?:#[^)]+)?\)/g;

    for (const locale of HELP_LOCALES) {
      for (const topic of HELP_TOPICS) {
        const body = readFileSync(path.join(HELP_ROOT, locale, `${topic.slug}.md`), "utf8");
        const linkedSlugs = [...body.matchAll(internalLink)].map((match) => match[1]);
        for (const linkedSlug of linkedSlugs) {
          expect(getHelpTopic(linkedSlug), `${locale}/${topic.slug} links to ${linkedSlug}`).toBeDefined();
        }
      }
    }
  });
});

describe("contextual guide routes", () => {
  it.each([
    ["/", "getting-started"],
    ["/prompts/new", "prompts"],
    ["/skills/id/edit", "skills"],
    ["/docs/id", "docs"],
    ["/plans/id/edit", "plans"],
    ["/projects/id", "projects"],
    ["/workflows/id/edit", "workflows"],
    ["/search", "finding-content"],
    ["/explore", "finding-content"],
    ["/import", "reuse-and-portability"],
    ["/settings/tokens", "connect-agent"],
    ["/settings/orgs/id", "spaces-and-permissions"],
    ["/settings/users", "users-and-roles"],
    ["/settings/audit", "audit-log"],
    ["/help/prompts", null],
  ] as const)("maps %s to %s", (pathname, topic) => {
    expect(topicForPathname(pathname)).toBe(topic);
  });
});
