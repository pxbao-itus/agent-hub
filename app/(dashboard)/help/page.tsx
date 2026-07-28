import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { HelpShell, HelpAudienceBadges } from "@/components/help/help-shell";
import {
  HELP_SECTIONS,
  HELP_SECTION_TITLES,
  HELP_TOPICS,
} from "@/content/help/registry";
import { getHelpLocale } from "@/lib/help";

export const metadata: Metadata = { title: "Help" };

export default async function HelpIndexPage() {
  const locale = await getHelpLocale();
  const copy =
    locale === "vi"
      ? {
          title: "Hướng dẫn sử dụng Agent Hub",
          description: "Chọn một chủ đề để bắt đầu hoặc mở hướng dẫn trực tiếp từ màn hình bạn đang sử dụng.",
        }
      : {
          title: "Agent Hub user guide",
          description: "Choose a topic below or open the relevant guide directly from the page you are using.",
        };

  return (
    <HelpShell locale={locale}>
      <div className="mb-8 space-y-3">
        <BookOpen className="h-8 w-8 text-muted-foreground" />
        <h1 className="text-3xl font-bold tracking-tight">{copy.title}</h1>
        <p className="max-w-2xl text-muted-foreground">{copy.description}</p>
      </div>

      <div className="space-y-8">
        {HELP_SECTIONS.map((section) => (
          <section key={section}>
            <h2 className="mb-3 text-lg font-semibold">{HELP_SECTION_TITLES[section][locale]}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {HELP_TOPICS.filter((topic) => topic.section === section).map((topic) => (
                <Link
                  key={topic.slug}
                  href={`/help/${topic.slug}`}
                  className="group rounded-lg border p-4 transition-colors hover:bg-muted/40"
                >
                  <div className="mb-1 flex items-start justify-between gap-3">
                    <h3 className="font-medium">{topic.title[locale]}</h3>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground">{topic.summary[locale]}</p>
                  <div className="mt-2">
                    <HelpAudienceBadges audience={topic.audience} locale={locale} />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </HelpShell>
  );
}
