"use client";

import { Bell, BellOff, BellRing, ChevronDown } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";

const LABELS = {
  all: "Following",
  mentions: "Mentions only",
  muted: "Muted",
} as const;

export function FollowMenu({ artifactId }: { artifactId: string }) {
  const utils = trpc.useUtils();
  const subscription = trpc.comment.getSubscription.useQuery({ artifactId });
  const update = trpc.comment.setSubscription.useMutation({
    onSuccess: async () => {
      await utils.comment.getSubscription.invalidate({ artifactId });
    },
    onError: (error) => toast({ title: "Could not update notifications", description: error.message, variant: "destructive" }),
  });
  const mode = subscription.data?.mode ?? null;
  const Icon = mode === "muted" ? BellOff : mode === "all" ? BellRing : Bell;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={subscription.isLoading || update.isPending}>
          <Icon className="mr-1.5 h-3.5 w-3.5" />
          {mode ? LABELS[mode] : "Follow"}
          <ChevronDown className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => update.mutate({ artifactId, mode: "all" })}>
          <BellRing className="mr-2 h-4 w-4" />
          <div>
            <p>All comments</p>
            <p className="text-xs text-muted-foreground">Comments and mentions</p>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => update.mutate({ artifactId, mode: "mentions" })}>
          <Bell className="mr-2 h-4 w-4" />
          <div>
            <p>Mentions only</p>
            <p className="text-xs text-muted-foreground">Only when someone mentions you</p>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => update.mutate({ artifactId, mode: "muted" })}>
          <BellOff className="mr-2 h-4 w-4" />
          <div>
            <p>Mute</p>
            <p className="text-xs text-muted-foreground">No discussion notifications</p>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

