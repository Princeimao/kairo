"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthCard, Spinner } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { githubLoginUrl } from "@/lib/api";

const ERROR_MESSAGES: Record<string, string> = {
  access_denied:
    "You cancelled the GitHub authorization, so there's nothing to sign in with.",
  state_mismatch:
    "That sign-in attempt expired or was already used. Please start again.",
  github_error:
    "GitHub returned an error while signing you in. Please try again in a moment.",
};

function GitHubIcon() {
  return (
    <svg className="mr-2 size-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.135-.345-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function LoginContent() {
  const errorKey = useSearchParams().get("error");
  const [pending, setPending] = useState(false);

  const errorMessage = errorKey
    ? (ERROR_MESSAGES[errorKey] ?? "Sign-in failed. Please try again.")
    : null;

  return (
    <AuthCard className="max-w-sm">
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Welcome to Kairo</h1>
          <p className="text-sm text-muted-foreground">
            Sign in with your GitHub account to get started.
          </p>
        </div>

        {errorMessage ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {errorMessage}
          </p>
        ) : null}

        <a
          href={githubLoginUrl}
          onClick={() => setPending(true)}
          aria-busy={pending}
        >
          <Button className="w-full" size="lg" disabled={pending}>
            {pending ? <Spinner className="mr-2" /> : <GitHubIcon />}
            {pending ? "Redirecting to GitHub…" : "Continue with GitHub"}
          </Button>
        </a>

        <p className="text-xs text-muted-foreground">
          Kairo asks for <span className="text-foreground">read:user</span>,{" "}
          <span className="text-foreground">user:email</span> and{" "}
          <span className="text-foreground">repo</span> — nothing more.
        </p>
      </div>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <AuthCard className="max-w-sm">
          <Spinner className="mx-auto size-5 text-muted-foreground" />
        </AuthCard>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
