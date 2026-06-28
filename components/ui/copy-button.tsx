"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  text: string;
  className?: string;
};

export function CopyButton({ text, className }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      title={copied ? "Copied!" : "Copy to clipboard"}
      className={cn(
        "rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        copied && "text-success hover:text-success",
        className,
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}
