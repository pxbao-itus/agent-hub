"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function FavoriteButton({ artifactId, initialFavorited }: { artifactId: string; initialFavorited: boolean }) {
  const [favorited, setFavorited] = useState(initialFavorited);

  const toggle = trpc.favorite.toggle.useMutation({
    onSuccess: (result) => setFavorited(result.favorited),
    onError: (e) => toast({ title: "Failed to update favorite", description: e.message, variant: "destructive" }),
  });

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={toggle.isPending}
      onClick={() => toggle.mutate({ artifactId })}
      aria-pressed={favorited}
      aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
    >
      <Star className={cn("h-3.5 w-3.5", favorited && "fill-current text-yellow-500")} />
    </Button>
  );
}
