"use client";

import { useState } from "react";
import { Building2, Users, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

type GroupType = "org" | "department" | "team";

interface GroupAvatarProps {
  image?: string | null;
  name: string;
  groupType: GroupType;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE = {
  sm: { outer: "h-8 w-8", icon: "h-4 w-4", text: "text-xs" },
  md: { outer: "h-10 w-10", icon: "h-5 w-5", text: "text-sm" },
  lg: { outer: "h-16 w-16", icon: "h-8 w-8", text: "text-xl" },
};

const ICON: Record<GroupType, React.ComponentType<{ className?: string }>> = {
  org: Shield,
  department: Building2,
  team: Users,
};

export function GroupAvatar({ image, name, groupType, size = "md", className }: GroupAvatarProps) {
  const [imgError, setImgError] = useState(false);
  const s = SIZE[size];
  const Icon = ICON[groupType];
  const initials = name.slice(0, 2).toUpperCase();

  if (image && !imgError) {
    return (
      <img
        src={image}
        alt={name}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setImgError(true)}
        className={cn(s.outer, "rounded-full object-cover shrink-0", className)}
      />
    );
  }

  return (
    <div
      className={cn(
        s.outer,
        "rounded-full bg-muted flex items-center justify-center shrink-0",
        className,
      )}
      aria-label={name}
    >
      {name ? (
        <span className={cn(s.text, "font-semibold text-muted-foreground select-none")}>
          {initials}
        </span>
      ) : (
        <Icon className={cn(s.icon, "text-muted-foreground")} />
      )}
    </div>
  );
}
