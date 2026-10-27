"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { gsap } from "gsap";
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

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.135-.345-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function LoginContent() {
  const errorKey = useSearchParams().get("error");
  const [pending, setPending] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const errorMessage = errorKey
    ? (ERROR_MESSAGES[errorKey] ?? "Sign-in failed. Please try again.")
    : null;

  useEffect(() => {
    if (!cardRef.current) return;
    const ctx = gsap.context(() => {
      gsap.from(".login-line", {
        y: 22,
        opacity: 0,
        stagger: 0.1,
        duration: 0.7,
        ease: "power3.out",
      });
      gsap.from(".login-glow", {
        scale: 0.5,
        opacity: 0,
        duration: 1,
        ease: "elastic.out(1, 0.55)",
        delay: 0.25,
      });
    }, cardRef);
    return () => ctx.revert();
  }, [errorKey]);

  return (
    <AuthCard className="max-w-sm" innerRef={cardRef}>
      <div className="space-y-6">
        <div className="space-y-3">
          <div className="login-glow mx-auto flex size-12 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-500/40">
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 10.5l7-7 7-1.5-1.5 7-7 7-4-4z" />
              <circle cx="14.5" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <h1 className="login-line text-2xl font-bold tracking-tight text-white">
            Welcome to Kairo
          </h1>
          <p className="login-line text-sm text-neutral-300">
            Sign in with the Kairo GitHub App and install it on the
            repositories it should work in.
          </p>
        </div>

        {errorMessage ? (
          <p
            role="alert"
            className="rounded-xl border border-red-200/70 bg-red-50/60 px-3 py-2 text-sm text-red-600"
          >
            {errorMessage}
          </p>
        ) : null}

        <a href={githubLoginUrl} onClick={() => setPending(true)} aria-busy={pending}>
          <Button
            className="login-line w-full cursor-pointer rounded-xl bg-neutral-950 text-white transition-colors hover:bg-orange-500"
            size="lg"
            disabled={pending}
          >
            {pending ? <Spinner className="mr-2" /> : <GitHubIcon className="mr-2 size-5" />}
            {pending ? "Redirecting to GitHub…" : "Continue with GitHub"}
          </Button>
        </a>

        <p className="login-line text-xs leading-relaxed text-neutral-400">
          Kairo&rsquo;s GitHub App carries its own permissions — contents,
          issues and pull requests on the repositories you install it on.
          Revoke access anytime under GitHub → Settings → Installed GitHub Apps.
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
          <Spinner className="mx-auto size-5 text-neutral-400" />
        </AuthCard>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
