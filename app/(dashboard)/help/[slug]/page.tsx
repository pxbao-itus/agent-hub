import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { MarkdownView } from "@/components/ui/markdown";
import { HelpShell, HelpAudienceBadges } from "@/components/help/help-shell";
import { getHelpTopic } from "@/content/help/registry";
import { getHelpLocale, loadHelpDocument } from "@/lib/help";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const topic = getHelpTopic(slug);
  if (!topic) return { title: "Help" };
  const locale = await getHelpLocale();
  return { title: `${topic.title[locale]} — Help`, description: topic.summary[locale] };
}

export default async function HelpTopicPage({ params }: Props) {
  const { slug } = await params;
  const topic = getHelpTopic(slug);
  if (!topic) notFound();

  const locale = await getHelpLocale();
  const content = await loadHelpDocument(locale, topic.slug);
  if (!content) notFound();

  const related = topic.related.map(getHelpTopic).filter((item) => item !== undefined);
  const relatedLabel = locale === "vi" ? "Hướng dẫn liên quan" : "Related guides";

  return (
    <HelpShell locale={locale} currentSlug={topic.slug}>
      <article>
        <header className="mb-8 space-y-3 border-b pb-6">
          <HelpAudienceBadges audience={topic.audience} locale={locale} />
          <h1 className="text-3xl font-bold tracking-tight">{topic.title[locale]}</h1>
          <p className="text-lg leading-relaxed text-muted-foreground">{topic.summary[locale]}</p>
        </header>

        <MarkdownView className="text-[0.95rem] leading-7">{content}</MarkdownView>

        {related.length > 0 && (
          <section className="mt-10 border-t pt-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {relatedLabel}
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {related.map((item) => (
                <Link
                  key={item.slug}
                  href={`/help/${item.slug}`}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm hover:bg-muted/40"
                >
                  {item.title[locale]}
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </Link>
              ))}
            </div>
          </section>
        )}
      </article>
    </HelpShell>
  );
}
