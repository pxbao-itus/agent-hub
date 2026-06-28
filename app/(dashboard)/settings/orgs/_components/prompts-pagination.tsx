import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 30;

interface Props {
  total: number;
  offset: number;
  baseUrl: string;
}

export function PromptsPagination({ total, offset, baseUrl }: Props) {
  if (total <= PAGE_SIZE) return null;

  const page = Math.floor(offset / PAGE_SIZE);
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const prevOffset = Math.max(0, offset - PAGE_SIZE);
  const nextOffset = offset + PAGE_SIZE;

  return (
    <div className="flex items-center justify-between pt-2">
      <Button asChild variant="outline" size="sm" disabled={offset === 0}>
        <Link href={`${baseUrl}?po=${prevOffset}`}>
          <ChevronLeft className="mr-1 h-4 w-4" />
          Previous
        </Link>
      </Button>
      <span className="text-xs text-muted-foreground">
        Page {page + 1} of {totalPages}
      </span>
      <Button asChild variant="outline" size="sm" disabled={nextOffset >= total}>
        <Link href={`${baseUrl}?po=${nextOffset}`}>
          Next
          <ChevronRight className="ml-1 h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}
