import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { GroupPromptItem } from "@/server/lib/group-prompts";

type Props = {
  items: GroupPromptItem[];
  showOwnerLabel: boolean;
};

const OWNER_VARIANT = {
  org: "default",
  department: "secondary",
  team: "outline",
} as const satisfies Record<GroupPromptItem["ownerType"], "default" | "secondary" | "outline">;

function ownerLabel(item: GroupPromptItem): string {
  if (item.ownerType === "org") return "Org";
  if (item.ownerType === "department") return `Dept · ${item.ownerName}`;
  return `Team · ${item.ownerName}`;
}

export function GroupPromptList({ items, showOwnerLabel }: Props) {
  if (items.length === 0) {
    return <EmptyState message="No prompts in this space yet." />;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <Link key={item.id} href={`/prompts/${item.id}`}>
          <Card className="h-full cursor-pointer transition-colors hover:bg-muted/50">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-sm leading-snug">{item.title}</CardTitle>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {showOwnerLabel && (
                    <Badge variant={OWNER_VARIANT[item.ownerType]} className="text-[10px]">
                      {ownerLabel(item)}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[10px]">
                    {item.visibility}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            {(item.preview || item.tags.length > 0) && (
              <CardContent className="space-y-2">
                {item.preview && (
                  <p className="line-clamp-3 font-mono text-xs text-muted-foreground">
                    {item.preview}
                  </p>
                )}
                {item.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {item.tags.map((t) => (
                      <Badge key={t} variant="secondary" className="text-[10px]">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        </Link>
      ))}
    </div>
  );
}
