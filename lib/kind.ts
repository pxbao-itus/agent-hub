import { BookText, Wrench, Package, ClipboardList, FileText, type LucideIcon } from "lucide-react";

export const KIND_LABEL: Record<string, string> = {
  prompt: "Prompts",
  skill: "Skills",
  kit: "Kits",
  plan: "Plans",
  doc: "Docs",
};

export const KIND_ICON: Record<string, LucideIcon> = {
  prompt: BookText,
  skill: Wrench,
  kit: Package,
  plan: ClipboardList,
  doc: FileText,
};

export function kindRoute(kind: string): string {
  return `/${kind}s`;
}
