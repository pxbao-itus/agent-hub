"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const METADATA_OPEN_KEY = "agent-hub:detail-metadata-open";

type DetailPageLayoutProps = {
  breadcrumb: ReactNode;
  children: ReactNode;
  metadata: ReactNode;
  metadataLabel?: string;
};

/**
 * Shared shell for entity detail pages. Data-heavy page content stays
 * server-rendered; this client boundary owns presentation state only.
 */
export function DetailPageLayout({
  breadcrumb,
  children,
  metadata,
  metadataLabel = "Metadata",
}: DetailPageLayoutProps) {
  const metadataId = useId();
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const [metadataOpen, setMetadataOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(METADATA_OPEN_KEY);
      if (stored !== null) setMetadataOpen(stored === "true");
    } catch {
      // Storage can be unavailable in locked-down browsers; default-open still works.
    } finally {
      setHydrated(true);
    }
  }, []);

  function setDesktopOpen(open: boolean) {
    setMetadataOpen(open);
    try {
      window.localStorage.setItem(METADATA_OPEN_KEY, String(open));
    } catch {
      // Preference persistence is best-effort only.
    }
  }

  return (
    <div className="space-y-5 lg:w-[calc(100%+2rem)]">
      {breadcrumb}

      <div className="flex items-center justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="hidden h-8 gap-1.5 text-xs lg:inline-flex"
          aria-controls={metadataId}
          aria-expanded={metadataOpen}
          onClick={() => setDesktopOpen(!metadataOpen)}
        >
          {metadataOpen ? (
            <PanelRightClose className="h-4 w-4" />
          ) : (
            <PanelRightOpen className="h-4 w-4" />
          )}
          {metadataOpen ? "Hide metadata" : "Show metadata"}
        </Button>

        <Button
          ref={mobileTriggerRef}
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 lg:hidden"
          aria-haspopup="dialog"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(true)}
        >
          <PanelRightOpen className="h-4 w-4" />
          Details
        </Button>
      </div>

      <div
        className={cn(
          "grid items-start gap-8",
          metadataOpen && "lg:grid-cols-[minmax(0,1fr)_20rem]",
          !hydrated && "transition-none",
        )}
      >
        <div className="min-w-0">{children}</div>

        {metadataOpen && (
          <aside
            id={metadataId}
            aria-label={metadataLabel}
            className="hidden min-w-0 border-l pl-6 pr-4 lg:sticky lg:top-4 lg:block"
          >
            <div className="space-y-6 pb-6">{metadata}</div>
          </aside>
        )}
      </div>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent
          className="inset-y-0 left-auto right-0 top-0 h-dvh w-[min(92vw,24rem)] max-w-none translate-x-0 translate-y-0 content-start gap-0 overflow-y-auto rounded-none border-y-0 border-r-0 p-0 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            mobileTriggerRef.current?.focus();
          }}
        >
          <DialogHeader className="sticky top-0 z-10 border-b bg-background px-5 py-4 text-left">
            <DialogTitle>{metadataLabel}</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 px-5 py-5">{metadata}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type DetailMetadataSectionProps = {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function DetailMetadataSection({
  title,
  count,
  action,
  children,
  className,
}: DetailMetadataSectionProps) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex min-h-7 items-center justify-between gap-2 border-b pb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
          {count !== undefined ? ` (${count})` : ""}
        </h2>
        {action}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
