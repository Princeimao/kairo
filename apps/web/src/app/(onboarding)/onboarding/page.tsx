"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { gsap } from "gsap";
import {
  ArrowRight,
  CircleCheck,
  ExternalLink,
  FolderGit2,
  Loader2,
  Mail,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { AuthCard, Spinner } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { ApiError, auth, type OnboardingStep, type PublicUser } from "@/lib/api";
import { cn, safeAvatarUrl } from "@/lib/utils";

const STEPS: Array<{ key: OnboardingStep; label: string }> = [
  { key: "WELCOME", label: "Welcome" },
  { key: "PROFILE", label: "Profile" },
  { key: "PERMISSIONS", label: "App install" },
  { key: "DONE", label: "Done" },
];

const APP_PERMISSIONS = [
  {
    icon: FolderGit2,
    slug: "contents + worktrees",
    title: "Read and write code",
    description:
      "Kairo reads your codebase, pushes fix branches and opens pull requests through its GitHub App installation.",
  },
  {
    icon: ShieldCheck,
    slug: "issues + PRs",
    title: "See issues, answer reviews",
    description:
      "It picks up the issues you assign and follows review comments until the PR is merged or closed.",
  },
  {
    icon: UserRound,
    slug: "installation token",
    title: "Scoped tokens only",
    description:
      "No personal passwords: the App talks with short-lived installation access tokens tied to the chosen repositories.",
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
        className="rounded-full border border-white/15"
      />
    );
  }

  return (
    <div
      className="flex items-center justify-center rounded-full border border-white/15 bg-neutral-800 font-semibold text-neutral-300"
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
              i <= index ? "bg-orange-500" : "bg-white/10",
            )}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-neutral-400">
          Step {index + 1} of {STEPS.length}
        </span>
        <span className="font-medium text-orange-400">{STEPS[index].label}</span>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [index, setIndex] = useState(0);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

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
    auth
      .githubApp()
      .then((app) => setInstallUrl(app.installUrl))
      .catch(() => undefined);
  }, [load]);

  // Animate each step panel in.
  useEffect(() => {
    if (!panelRef.current) return;
    const ctx = gsap.context(() => {
      gsap.from(".onboard-line", {
        y: 18,
        opacity: 0,
        stagger: 0.08,
        duration: 0.55,
        ease: "power3.out",
      });
      gsap.from(".onboard-panel", {
        scale: 0.985,
        opacity: 0,
        duration: 0.45,
        ease: "power2.out",
      });
    }, panelRef);
    return () => ctx.revert();
  }, [index]);

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
        <h1 className="text-xl font-semibold text-white">Something went wrong</h1>
        <p className="text-sm text-neutral-400">{loadError}</p>
        <Button
          className="w-full cursor-pointer rounded-xl bg-neutral-950 text-white hover:bg-orange-500"
          variant="outline"
          onClick={() => void load()}
        >
          Try again
        </Button>
      </AuthCard>
    );
  }

  if (!user) {
    return (
      <AuthCard className="max-w-sm">
        <Spinner className="mx-auto size-5 text-neutral-400" />
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <div ref={panelRef} className="space-y-8">
        <Progress index={index} />

        <div className="space-y-4">
          {index === 0 ? (
            <div className="onboard-panel space-y-3">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-500/40">
                <Sparkles className="size-6" />
              </div>
              <h1 className="onboard-line text-2xl font-bold tracking-tight text-white">
                Welcome to Kairo
              </h1>
              <p className="onboard-line text-sm text-neutral-300">
                Point Kairo at a GitHub issue and it reads the codebase, writes
                the fix, opens a PR and handles review comments — while you work
                on something else.
              </p>
            </div>
          ) : null}

          {index === 1 ? (
            <div className="onboard-panel space-y-4">
              <h1 className="onboard-line text-2xl font-bold tracking-tight text-white">
                Confirm your profile
              </h1>
              <div className="onboard-line flex items-center gap-3 rounded-xl border border-white/10 bg-neutral-800/60 p-3 text-left">
                <Avatar user={user} size={44} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">
                    {user.name ?? user.username}
                  </p>
                  <p className="truncate text-xs text-neutral-400">
                    @{user.username}
                  </p>
                </div>
              </div>
              <div className="onboard-line space-y-1 text-left text-sm text-neutral-300">
                <p className="flex items-center gap-2">
                  <Mail className="size-4 shrink-0" />
                  {user.email ?? "No public email on this account"}
                </p>
                <p className="text-xs text-neutral-400">
                  This is the GitHub identity Kairo will act as.
                </p>
              </div>
            </div>
          ) : null}

          {index === 2 ? (
            <div className="onboard-panel space-y-4">
              <h1 className="onboard-line text-2xl font-bold tracking-tight text-white">
                Install the Kairo GitHub App
              </h1>
              <p className="onboard-line text-sm text-neutral-300">
                Sign-in already runs through Kairo&rsquo;s GitHub App. Finish by
                installing it on the repositories the agent should work in.
              </p>
              <ul className="onboard-line space-y-3 text-left">
                {APP_PERMISSIONS.map(({ icon: Icon, slug, title, description }) => (
                  <li key={slug} className="flex gap-3">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-neutral-800/60 text-orange-400">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-white">
                        {title}{" "}
                        <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-xs text-neutral-400">
                          {slug}
                        </code>
                      </span>
                      <span className="block text-xs text-neutral-400">
                        {description}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              {installUrl ? (
                <a
                  href={installUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="onboard-line flex items-center justify-between rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-left text-sm text-orange-300 transition-colors hover:bg-orange-500/20"
                >
                  <span>
                    <span className="block font-medium">Install on GitHub ↗</span>
                    <span className="block text-xs text-orange-300/70">
                      opens github.com — pick the repos, then come back here
                    </span>
                  </span>
                  <ExternalLink className="size-4" />
                </a>
              ) : null}
              <p className="onboard-line text-xs text-neutral-500">
                You can manage or remove the installation anytime under GitHub →
                Settings → Installed GitHub Apps. Kairo never stores personal
                tokens beyond its App installation.
              </p>
            </div>
          ) : null}

          {index === 3 ? (
            <div className="onboard-panel space-y-3">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
                <CircleCheck className="size-6" />
              </div>
              <h1 className="onboard-line text-2xl font-bold tracking-tight text-white">
                You&rsquo;re all set
              </h1>
              <p className="onboard-line text-sm text-neutral-300">
                Kairo is connected to{" "}
                <span className="text-white">@{user.username}</span>. Head to the
                dashboard to see what it is doing.
              </p>
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          {actionError ? (
            <p
              role="alert"
              className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400"
            >
              {actionError}
            </p>
          ) : null}

          {index < STEPS.length - 1 ? (
            <Button
              className="w-full cursor-pointer rounded-xl bg-orange-500 text-white hover:bg-orange-400"
              size="lg"
              disabled={busy}
              onClick={() => void advance()}
            >
              {busy ? <Loader2 className="mr-2 animate-spin" /> : null}
              {busy
                ? "Saving…"
                : index === 0
                  ? "Get started"
                  : index === 1
                    ? "That's me"
                    : "I installed the App"}
              {!busy ? <ArrowRight className="ml-2" /> : null}
            </Button>
          ) : (
            <Button
              className="w-full cursor-pointer rounded-xl bg-orange-500 text-white hover:bg-orange-400"
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
