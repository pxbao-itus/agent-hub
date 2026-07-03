function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Splits `text` into segments, tagging which ones match a word in `query`
 * (case-insensitive). Keyword search (server/lib/search.ts) ANDs independent
 * lexemes via plainto_tsquery, not a single phrase — matching per-word
 * instead of the whole phrase reflects what actually made the result show
 * up. Pure/no JSX so it's unit-testable without a DOM (vitest here runs
 * with environment: "node", see vitest.config.ts).
 */
export function splitHighlight(text: string, query: string): { text: string; match: boolean }[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [{ text, match: false }];

  const pattern = new RegExp(`(${words.map(escapeRegExp).join("|")})`, "gi");
  const wordsLower = new Set(words.map((w) => w.toLowerCase()));

  return text
    .split(pattern)
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, match: wordsLower.has(part.toLowerCase()) }));
}

export function HighlightText({ text, query }: { text: string; query: string }) {
  return (
    <>
      {splitHighlight(text, query).map((seg, i) =>
        seg.match ? (
          <mark key={i} className="rounded-sm bg-yellow-200 px-0.5 text-inherit dark:bg-yellow-900/60">
            {seg.text}
          </mark>
        ) : (
          seg.text
        ),
      )}
    </>
  );
}
