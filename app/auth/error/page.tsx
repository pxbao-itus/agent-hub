import { Button } from "@/components/ui/button";

const ERROR_MESSAGES: Record<string, string> = {
  Configuration: "Server configuration error. Please contact the administrator.",
  AccessDenied: "Access denied.",
  Verification: "The verification link has expired or has already been used.",
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = error ? (ERROR_MESSAGES[error] ?? "An unexpected authentication error occurred.") : "An unexpected error occurred.";

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-bold">Authentication Error</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Button asChild variant="outline">
          <a href="/auth/signin">Back to sign in</a>
        </Button>
      </div>
    </div>
  );
}
