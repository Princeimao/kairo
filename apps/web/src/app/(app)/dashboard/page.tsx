"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { gsap } from "gsap";
import {
  Wand2,
  ListChecks,
  CheckCircle2,
  CircleX,
  Server,
  ArrowRight,
} from "lucide-react";
import { apiFetch, runs, type PublicUser, githubLoginUrl } from "@/lib/api";
import { safeAvatarUrl } from "@/lib/utils";

export default function DashboardPage() {
  const gridRef = React.useRef<HTMLDivElement>(null);
  const [user, setUser] = React.useState<PublicUser | null>(null);
  const [runCount, setRunCount] = React.useState<number | null>(null);

  React.useEffect(() => {
    apiFetch<{ user: PublicUser }>("/auth/me")
      .then((r) => setUser(r.user))
      .catch(() => undefined);
    runs.list().then((all) => setRunCount(all.length)).catch(() => undefined);
  }, []);

  React.useEffect(() => {
    if (!gridRef.current) return;
    const ctx = gsap.context(() => {
      gsap.from(".stat-card", {
        y: 28,
        opacity: 0,
        scale: 0.97,
        stagger: 0.1,
        duration: 0.75,
        ease: "power3.out",
      });
      gsap.from(".dash-head", {
        y: 20,
        opacity: 0,
        stagger: 0.09,
        duration: 0.65,
        ease: "power3.out",
        delay: 0.1,
      });
    }, gridRef);
    return () => ctx.revert();
  }, []);

  const avatarUrl = safeAvatarUrl(user?.avatarUrl ?? null);
  const greeting = user?.name || user?.username || "there";

  return (
    <div ref={gridRef} className="mx-auto max-w-5xl px-4 py-10 md:px-8">
      <div className="dash-head mb-1 text-sm font-medium text-orange-500">
        dashboard
      </div>
      <h1 className="dash-head mb-8 text-3xl font-semibold tracking-tight text-neutral-950 md:text-4xl">
        Welcome back, {greeting}
      </h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/agent"
          className="stat-card group relative overflow-hidden rounded-2xl bg-neutral-950 p-6 text-white shadow-sm transition-transform hover:-translate-y-0.5"
        >
          <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-orange-500">
            <Wand2 className="size-5 text-white" />
          </div>
          <div className="text-lg font-semibold">Open agent</div>
          <p className="mt-1 text-sm text-neutral-400">
            Run coding tasks in your sandbox.
          </p>
          <ArrowRight className="absolute right-5 top-6 size-4 text-neutral-500 transition-transform group-hover:translate-x-1 group-hover:text-orange-500" />
        </Link>

        <div className="stat-card rounded-2xl border border-neutral-200/70 bg-white p-6 shadow-sm">
          <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-neutral-100">
            <ListChecks className="size-5 text-neutral-500" />
          </div>
          <div className="text-lg font-semibold text-neutral-950">
            {runCount === null ? "…" : runCount}
          </div>
          <p className="mt-1 text-sm text-neutral-500">agent runs, newest first</p>
        </div>

        {user ? (
          <div className="stat-card rounded-2xl border border-neutral-200/70 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt="@user"
                  width={40}
                  height={40}
                  className="rounded-full border border-neutral-200"
                />
              ) : (
                <div className="flex size-10 items-center justify-center rounded-full bg-orange-500/10 text-base font-semibold text-orange-600">
                  {user.username.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-neutral-950">
                  {user.name ?? user.username}
                </div>
                <div className="truncate text-xs text-neutral-400">@{user.username}</div>
              </div>
              <Server className="ml-auto size-4 text-neutral-300" />
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs text-neutral-500">
              <CheckCircle2 className="size-3.5 text-emerald-500" />
              GitHub connected · onboarding {user.onboardingStep.toLowerCase()}
            </div>
          </div>
        ) : (
          <a
            href={githubLoginUrl}
            className="stat-card flex flex-col items-start rounded-2xl border border-neutral-200/70 bg-white p-6 shadow-sm transition-colors hover:border-orange-300"
          >
            <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-neutral-100">
              <CircleX className="size-5 text-neutral-400" />
            </div>
            <div className="text-lg font-semibold text-neutral-950">Sign in</div>
            <p className="mt-1 text-sm text-neutral-500">Connect through GitHub.</p>
          </a>
        )}
      </div>
    </div>
  );
}
