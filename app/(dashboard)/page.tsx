import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function DashboardHome() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Welcome to prompt-hub</h1>
      <p className="text-muted-foreground">Manage and share your prompts across teams.</p>
      <Button asChild>
        <Link href="/settings/orgs">Go to Organizations</Link>
      </Button>
    </div>
  );
}
