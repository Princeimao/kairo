"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { AuthCard, Spinner } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { ApiError, auth, type PublicUser } from "@/lib/api";
import { safeAvatarUrl } from "@/lib/utils";

function Avatar({ user }: { user: PublicUser }) {
  const size = 64;
  const avatarUrl = safeAvatarUrl(user.avatarUrl);
  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt={user.username}
        width={size}
        height={size}
        className="rounded-full border border-border/60"
        priority
      />
    );
  }
  return (
    <div className="flex size-16 items-center justify-center rounded-full border border-border/60 bg-muted text-xl font-semibold text-muted-foreground">
      {user.username.slice(0, 1).toUpperCase()}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      auth.me().then(
        (me) => {
          setUser(me);
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

  const logout = async () => {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await auth.logout();
      router.replace("/login");
      router.refresh();
    } catch {
      setLogoutError("Sign-out failed. Please try again.");
      setLoggingOut(false);
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
    <AuthCard className="space-y-6">
      <div className="flex flex-col items-center gap-3">
        <Avatar user={user} />
        <div className="text-center">
          <h1 className="text-xl font-bold tracking-tight">
            {user.name ?? user.username}
          </h1>
          <p className="text-sm text-muted-foreground">@{user.username}</p>
        </div>
        {user.email ? (
          <span className="rounded-full border border-border/60 bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
            {user.email}
          </span>
        ) : null}
      </div>

      <div className="rounded-lg border border-border/60 bg-muted/40 px-4 py-3 text-left text-sm">
        <p className="font-medium">Connected to GitHub</p>
        <p className="text-xs text-muted-foreground">
          Kairo uses your token to read issues and open pull requests.
        </p>
      </div>

      <div className="space-y-2">
        {logoutError ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {logoutError}
          </p>
        ) : null}
        <Button
          className="w-full"
          variant="outline"
          size="lg"
          disabled={loggingOut}
          onClick={() => void logout()}
        >
          {loggingOut ? <Loader2 className="mr-2 animate-spin" /> : <LogOut className="mr-2" />}
          {loggingOut ? "Signing out…" : "Log out"}
        </Button>
      </div>
    </AuthCard>
  );
}
