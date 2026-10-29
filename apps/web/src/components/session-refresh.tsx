"use client";

import { useEffect, useRef } from "react";
import { auth } from "@/lib/api";

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // periodic rotation
const REFRESH_MIN_GAP_MS = 5 * 60 * 1000; // throttle (focus storms, remounts)

/**
 * Keeps the browser session alive: rotates the token on mount, whenever the
 * tab regains focus, and every 6 hours — at most one attempt per 5 minutes
 * and single-flighted, so overlapping triggers share one request. Failures
 * are swallowed: a 401 means the session is already gone (the page guards
 * handle the logout), a network blip just retries next trigger.
 */
export function SessionRefresh() {
  const lastAttemptRef = useRef(0);
  const inflightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const refresh = (): Promise<void> => {
      if (inflightRef.current) return inflightRef.current;
      if (Date.now() - lastAttemptRef.current < REFRESH_MIN_GAP_MS) {
        return Promise.resolve();
      }
      lastAttemptRef.current = Date.now();
      inflightRef.current = auth
        .refresh()
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => {
          inflightRef.current = null;
        });
      return inflightRef.current;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return null;
}
