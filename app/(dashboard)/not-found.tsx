import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
      <p className="text-4xl font-bold text-muted-foreground">404</p>
      <p className="text-lg font-semibold">Page not found</p>
      <p className="text-sm text-muted-foreground">The page you&apos;re looking for doesn&apos;t exist or you don&apos;t have access.</p>
      <Button asChild variant="outline">
        <Link href="/">Go home</Link>
      </Button>
    </div>
  );
}
