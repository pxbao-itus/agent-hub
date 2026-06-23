import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { SignUpForm } from "./sign-up-form";

export default async function SignUpPage() {
  const session = await auth();
  if (session) redirect("/");

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">prompt-hub</h1>
          <p className="mt-1 text-sm text-muted-foreground">Create your account</p>
        </div>

        <SignUpForm />

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <a href="/auth/signin" className="font-medium underline underline-offset-4 hover:text-foreground">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
