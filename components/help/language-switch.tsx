"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { HELP_LOCALE_COOKIE, type HelpLocale } from "@/content/help/registry";

export function HelpLanguageSwitch({ locale }: { locale: HelpLocale }) {
  const router = useRouter();

  function selectLocale(nextLocale: HelpLocale) {
    document.cookie = `${HELP_LOCALE_COOKIE}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    router.refresh();
  }

  return (
    <div className="flex rounded-md border p-0.5" aria-label="Guide language">
      <Button
        type="button"
        variant={locale === "vi" ? "default" : "ghost"}
        size="sm"
        className="h-7 px-2.5 text-xs"
        aria-pressed={locale === "vi"}
        onClick={() => selectLocale("vi")}
      >
        Tiếng Việt
      </Button>
      <Button
        type="button"
        variant={locale === "en" ? "default" : "ghost"}
        size="sm"
        className="h-7 px-2.5 text-xs"
        aria-pressed={locale === "en"}
        onClick={() => selectLocale("en")}
      >
        English
      </Button>
    </div>
  );
}
