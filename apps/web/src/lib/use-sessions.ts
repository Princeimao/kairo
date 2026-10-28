"use client";

import { useCallback, useEffect, useState } from "react";
import { runs, type RunSummary } from "@/lib/api";

/** Custom event the agent console dispatches after creating/resuming a run. */
export const RUNS_REFRESH_EVENT = "kairo:runs-changed";

/**
 * Recent agent runs ("sessions"). Polled lightly and refreshed immediately
 * when the console announces a new run via RUNS_REFRESH_EVENT.
 */
export function useSessions() {
  const [sessions, setSessions] = useState<RunSummary[]>([]);

  const refresh = useCallback(() => {
    runs
      .list()
      .then(setSessions)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 8_000);
    const onAnnounce = () => refresh();
    window.addEventListener(RUNS_REFRESH_EVENT, onAnnounce);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(RUNS_REFRESH_EVENT, onAnnounce);
    };
  }, [refresh]);

  const announce = useCallback(() => {
    window.dispatchEvent(new Event(RUNS_REFRESH_EVENT));
  }, []);

  return { sessions, refresh, announce } as const;
}

/** Announce a run change without calling the hook. */
export function announceRun(): void {
  window.dispatchEvent(new Event(RUNS_REFRESH_EVENT));
}
