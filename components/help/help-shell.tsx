import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { HelpLanguageSwitch } from "@/components/help/language-switch";
import {
  HELP_SECTIONS,
  HELP_SECTION_TITLES,
  HELP_TOPICS,
  type HelpLocale,
} from "@/content/help/registry";
import { cn } from "@/lib/utils";

export function HelpShell({
  locale,
  currentSlug,
  children,
}: {
  locale: HelpLocale;
  currentSlug?: string;
  children: React.ReactNode;
}) {
  const labels =
    locale === "vi"
      ? { help: "Hướng dẫn", all: "Tất cả hướng dẫn", topics: "Chủ đề hướng dẫn" }
      : { help: "Help", all: "All guides", topics: "Guide topics" };

  const topicNavigation = (
    <nav aria-label={labels.topics} className="space-y-5">
      {HELP_SECTIONS.map((section) => (
        <section key={section}>
          <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {HELP_SECTION_TITLES[section][locale]}
          </h2>
          <ul className="space-y-0.5">
            {HELP_TOPICS.filter((topic) => topic.section === section).map((topic) => (
              <li key={topic.slug}>
                <Link
                  href={`/help/${topic.slug}`}
                  aria-current={currentSlug === topic.slug ? "page" : undefined}
                  className={cn(
                    "block rounded-md px-2 py-1.5 text-sm transition-colors",
                    currentSlug === topic.slug
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  {topic.title[locale]}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Breadcrumb
          items={[
            { label: labels.help, href: "/help" },
            ...(currentSlug
              ? [{ label: HELP_TOPICS.find((topic) => topic.slug === currentSlug)?.title[locale] ?? currentSlug }]
              : []),
          ]}
        />
        <HelpLanguageSwitch locale={locale} />
      </div>

      <details className="rounded-lg border p-3 lg:hidden">
        <summary className="cursor-pointer text-sm font-medium">{labels.all}</summary>
        <div className="mt-4">{topicNavigation}</div>
      </details>

      <div className="grid items-start gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="sticky top-4 hidden max-h-[calc(100dvh-3rem)] overflow-y-auto pr-3 lg:block">
          {topicNavigation}
        </aside>
        <div className="min-w-0">
          <div className="max-w-3xl">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function HelpAudienceBadges({
  audience,
  locale,
}: {
  audience: readonly string[];
  locale: HelpLocale;
}) {
  if (audience.includes("user")) return null;
  return (
    <div className="flex gap-1">
      {audience.map((role) => (
        <Badge key={role} variant="outline" className="text-[10px]">
          {locale === "vi" && role === "admin" ? "quản trị viên" : role}
        </Badge>
      ))}
    </div>
  );
}
