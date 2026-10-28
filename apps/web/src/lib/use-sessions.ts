"use client";

import { useCallback, useEffect, useState } from "react";
import { sessions, type SessionSummary } from "@/lib/api";

/** Custom event the agent console dispatches after creating/resuming a run. */
export const RUNS_REFRESH_EVENT = "kairo:runs-changed";

/**
 * Chat sessions (each holds many conversations). Polled lightly and refreshed
 * immediately when the console announces a change via RUNS_REFRESH_EVENT.
 */
export function useSessions() {
  const [sessionsList, setSessionsList] = useState<SessionSummary[]>([]);

  const refresh = useCallback(() => {
    sessions
      .list()
      .then(setSessionsList)
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

  return { sessions: sessionsList, refresh, announce } as const;
}

/** Announce a session/run change without calling the hook. */
export function announceRun(): void {
  window.dispatchEvent(new Event(RUNS_REFRESH_EVENT));
}
