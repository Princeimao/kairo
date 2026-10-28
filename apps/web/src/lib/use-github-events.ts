"use client";

import { useCallback, useEffect, useState } from "react";
import { github, githubLoginUrl, type GithubEventItem } from "@/lib/api";

const INTERESTING_ACTIONS = new Set([
  "opened",
  "submitted",
  "created",
  "reopened",
  "assigned",
  "commented",
  "edited",
  "completed",
  "closed",
]);

/**
 * GitHub activity pulled from the webhook feed. Polls slowly; a 401 simply
 * means the visitor is signed out (we keep whatever we already have).
 */
export function useGithubEvents() {
  const [events, setEvents] = useState<GithubEventItem[]>([]);

  const refresh = useCallback(() => {
    github
      .events()
      .then((all) =>
        setEvents(
          all.filter(
            (item) =>
              !item.action || INTERESTING_ACTIONS.has(item.action) || item.eventType === "ping",
          ),
        ),
      )
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 20_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return events;
}

/** Browses the GitHub App install page for users who haven't installed yet. */
export const githubInstallHint = githubLoginUrl;
