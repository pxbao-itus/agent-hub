import { readFile } from "node:fs/promises";
import path from "node:path";
import { cookies, headers } from "next/headers";
import {
  getHelpTopic,
  HELP_LOCALE_COOKIE,
  isHelpLocale,
  type HelpLocale,
  type HelpTopicSlug,
} from "@/content/help/registry";

export async function getHelpLocale(): Promise<HelpLocale> {
  const cookieStore = await cookies();
  const stored = cookieStore.get(HELP_LOCALE_COOKIE)?.value;
  if (isHelpLocale(stored)) return stored;

  const requestHeaders = await headers();
  const accepted = requestHeaders.get("accept-language")?.toLowerCase() ?? "";
  return accepted.split(",").some((entry) => entry.trim().startsWith("vi")) ? "vi" : "en";
}

export async function loadHelpDocument(locale: HelpLocale, slug: HelpTopicSlug) {
  const topic = getHelpTopic(slug);
  if (!topic) return null;

  const filePath = path.join(process.cwd(), "content", "help", locale, `${slug}.md`);
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
