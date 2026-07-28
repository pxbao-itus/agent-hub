import Link from "next/link";
import { cn } from "@/lib/utils";

type Props = {
  userId: string | null;
  name: string | null;
  username?: string | null;
  email?: string | null;
  image?: string | null;
  className?: string;
  compact?: boolean;
};

export function UserIdentityLink({
  userId,
  name,
  username,
  email,
  image,
  className,
  compact = false,
}: Props) {
  const label = name ?? (username ? `@${username}` : email) ?? "Deleted user";
  const avatar = (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-medium",
        compact ? "h-6 w-6 text-[10px]" : "h-9 w-9 text-xs",
      )}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="h-full w-full object-cover" />
      ) : (
        (label[0] ?? "?").toUpperCase()
      )}
    </span>
  );
  const content = (
    <>
      {avatar}
      <span className="min-w-0">
        <span className="block truncate font-medium">{label}</span>
        {!compact && username && name && (
          <span className="block truncate text-xs text-muted-foreground">@{username}</span>
        )}
      </span>
    </>
  );

  if (!userId) {
    return <span className={cn("inline-flex items-center gap-2", className)}>{content}</span>;
  }
  return (
    <Link
      href={`/users/${userId}`}
      className={cn(
        "inline-flex min-w-0 items-center gap-2 rounded-sm hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {content}
    </Link>
  );
}
