"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CircleCheck,
  FolderGit2,
  Loader2,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { AuthCard, Spinner } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { ApiError, auth, type OnboardingStep, type PublicUser } from "@/lib/api";
import { cn, safeAvatarUrl } from "@/lib/utils";

const STEPS: Array<{ key: OnboardingStep; label: string }> = [
  { key: "WELCOME", label: "Welcome" },
  { key: "PROFILE", label: "Profile" },
  { key: "PERMISSIONS", label: "Permissions" },
  { key: "DONE", label: "Done" },
];

const PERMISSIONS = [
  {
    icon: UserRound,
    scope: "read:user",
    title: "Read your profile",
    description: "Your name, handle and avatar — so Kairo shows who is running it.",
  },
  {
    icon: Mail,
    scope: "user:email",
    title: "Read your primary verified email",
    description: "Used only to notify you about runs that need your attention.",
  },
  {
    icon: FolderGit2,
    scope: "repo",
    title: "Read and write your repositories",
    description:
      "Lets Kairo read code, push branches and open pull requests for the issues it fixes.",
  },
] as const;

function stepIndex(step: OnboardingStep): number {
  const index = STEPS.findIndex((entry) => entry.key === step);
  return index === -1 ? 0 : index;
}

function Avatar({ user, size }: { user: PublicUser; size: number }) {
  const avatarUrl = safeAvatarUrl(user.avatarUrl);

  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt={user.username}
        width={size}
        height={size}
        className="rounded-full border border-border/60"
      />
    );
  }

  return (
    <div
      className="flex items-center justify-center rounded-full border border-border/60 bg-muted font-semibold text-muted-foreground"
      style={{ width: size, height: size }}
    >
      {user.username.slice(0, 1).toUpperCase()}
    </div>
  );
}

function Progress({ index }: { index: number }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {STEPS.map((step, i) => (
          <div
            key={step.key}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i <= index ? "bg-primary" : "bg-muted",
            )}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          Step {index + 1} of {STEPS.length}
        </span>
        <span className="font-medium">{STEPS[index].label}</span>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [index, setIndex] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      auth.me().then(
        (me) => {
          setUser(me);
          setIndex(stepIndex(me.onboardingStep));
          setLoadError(null);
        },
        (err: unknown) => {
          if (err instanceof ApiError && err.status === 401) {
            void router.replace("/login");
            return;
          }
          setLoadError(
            err instanceof ApiError
              ? err.message
              : "Could not reach the Kairo API.",
          );
        },
      ),
    [router],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const nextStep = STEPS[index + 1];

  const advance = async () => {
    if (!nextStep || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const updated = await auth.setOnboardingStep(nextStep.key);
      setUser(updated);
      setIndex((current) => current + 1);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <AuthCard className="max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button className="w-full" variant="outline" onClick={() => void load()}>
          Try again
        </Button>
      </AuthCard>
    );
  }

  if (!user) {
    return (
      <AuthCard className="max-w-sm">
        <Spinner className="mx-auto size-5 text-muted-foreground" />
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <div className="space-y-8">
        <Progress index={index} />

        <div className="space-y-4">
          {index === 0 ? (
            <div className="space-y-3">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-border/60 bg-muted">
                <ShieldCheck className="size-6" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">
                Welcome to Kairo
              </h1>
              <p className="text-sm text-muted-foreground">
                Point Kairo at a GitHub issue and it reads the codebase, writes
                the fix, opens a PR and handles review comments — while you work
                on something else.
              </p>
            </div>
          ) : null}

          {index === 1 ? (
            <div className="space-y-4">
              <h1 className="text-2xl font-bold tracking-tight">
                Confirm your profile
              </h1>
              <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/40 p-3 text-left">
                <Avatar user={user} size={44} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {user.name ?? user.username}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    @{user.username}
                  </p>
                </div>
              </div>
              <div className="space-y-1 text-left text-sm text-muted-foreground">
                <p className="flex items-center gap-2">
                  <Mail className="size-4 shrink-0" />
                  {user.email ?? "No public email on this account"}
                </p>
                <p className="text-xs">
                  This is the GitHub identity Kairo will act as.
                </p>
              </div>
            </div>
          ) : null}

          {index === 2 ? (
            <div className="space-y-4">
              <h1 className="text-2xl font-bold tracking-tight">
                What Kairo asks for
              </h1>
              <p className="text-sm text-muted-foreground">
                Kairo requested exactly three scopes from GitHub:
              </p>
              <ul className="space-y-3 text-left">
                {PERMISSIONS.map(({ icon: Icon, scope, title, description }) => (
                  <li key={scope} className="flex gap-3">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        {title}{" "}
                        <code className="rounded bg-muted px-1 py-0.5 text-xs text-muted-foreground">
                          {scope}
                        </code>
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {description}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                You can revoke access at any time under GitHub → Settings →
                Applications.
              </p>
            </div>
          ) : null}

          {index === 3 ? (
            <div className="space-y-3">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                <CircleCheck className="size-6" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">
                You&rsquo;re all set
              </h1>
              <p className="text-sm text-muted-foreground">
                Kairo is connected to{" "}
                <span className="text-foreground">@{user.username}</span>. Head
                to the dashboard to see what it is doing.
              </p>
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          {actionError ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {actionError}
            </p>
          ) : null}

          {index < STEPS.length - 1 ? (
            <Button className="w-full" size="lg" disabled={busy} onClick={() => void advance()}>
              {busy ? <Loader2 className="mr-2 animate-spin" /> : null}
              {busy
                ? "Saving…"
                : index === 0
                  ? "Get started"
                  : index === 1
                    ? "That's me"
                    : "I understand"}
              {!busy ? <ArrowRight className="ml-2" /> : null}
            </Button>
          ) : (
            <Button
              className="w-full"
              size="lg"
              onClick={() => router.push("/dashboard")}
            >
              Go to dashboard
              <ArrowRight className="ml-2" />
            </Button>
          )}
        </div>
      </div>
    </AuthCard>
  );
}
