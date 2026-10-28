"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, runs, type AgentEvent, type RunStatus } from "@/lib/api";

export type ToolStep = {
  id: string;
  name: string;
  status: "pending" | "ok" | "failed";
  durationMs: number | null;
  output: string | null;
};

export type RunView = {
  status: RunStatus | "WAITING";
  prompt: string;
  approach: string | null;
  planGoals: string[];
  replans: string[];
  tools: ToolStep[];
  texts: string[];
  summary: string | null;
  error: { code: string; message: string } | null;
  durationMs: number | null;
};

const EMPTY: RunView = {
  status: "WAITING",
  prompt: "",
  approach: null,
  planGoals: [],
  replans: [],
  tools: [],
  texts: [],
  summary: null,
  error: null,
  durationMs: null,
};

function outputToText(output: unknown): string | null {
  if (output === undefined || output === null) return null;
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

export function useRunStream() {
  const router = useRouter();
  const [view, setView] = useState<RunView>(EMPTY);
  const sourceRef = useRef<EventSource | null>(null);
  const runIdRef = useRef<string | null>(null);

  const close = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const reset = useCallback(() => {
    close();
    setView(EMPTY);
  }, [close]);

  const apply = useCallback(
    (event: AgentEvent) => {
      setView((prev) => {
        switch (event.type) {
          case "plan":
            return {
              ...prev,
              status: "RUNNING",
              approach: event.plan.approach,
              planGoals: event.plan.steps.map((s) => s.goal),
              replans: [],
            };
          case "replan":
            return {
              ...prev,
              replans: [...prev.replans, event.reason],
              planGoals: [],
              approach: `replanning: ${event.reason}`,
            }; // replaced when the fresh plan event lands
          case "tool_call": {
            const step: ToolStep = {
              id: event.id,
              name: event.name,
              status: "pending",
              durationMs: null,
              output: null,
            };
            const tools = [...prev.tools];
            const idx = tools.findIndex((t) => t.id === step.id);
            if (idx === -1) tools.push(step);
            else tools[idx] = step;
            return { ...prev, tools };
          }
          case "tool_result": {
            const tools = [...prev.tools];
            const idx = tools.findIndex((t) => t.id === event.id);
            if (idx === -1) return prev;
            tools[idx] = {
              ...tools[idx],
              status: event.ok ? "ok" : "failed",
              durationMs: event.durationMs,
              output: outputToText(event.output),
            };
            return { ...prev, tools };
          }
          case "text":
            return { ...prev, texts: [...prev.texts, event.text] };
          case "error":
            return {
              ...prev,
              error: { code: event.code, message: event.message },
            };
          case "done":
            return {
              ...prev,
              status: event.status,
              summary: event.summary,
              error: event.error ?? prev.error,
              durationMs: event.durationMs,
            };
          default:
            return prev;
        }
      });
      const e = event as AgentEvent;
      if (e.type === "done") close();
    },
    [close],
  );

  const openStream = useCallback(
    (runId: string) => {
      const source = new EventSource(runs.eventsUrl(runId), {
        withCredentials: true,
      });
      sourceRef.current = source;
      source.onmessage = (msg) => {
        try {
          apply(JSON.parse(msg.data) as AgentEvent);
        } catch {
          // malformed frame: skip
        }
      };
      source.onerror = () => {
        const failed = new ApiError(0, "Lost connection to the Kairo API");
        setView((prev) =>
          prev.status === "RUNNING" || prev.status === "WAITING"
            ? {
                ...prev,
                error: { code: "STREAM_LOST", message: failed.message },
              }
            : prev,
        );
      };
    },
    [apply],
  );

  const start = useCallback(
    async (prompt: string, mode: "CREATE" | "FIX" = "CREATE") => {
      close();
      setView({ ...EMPTY, prompt });
      try {
        const created = await runs.create({ prompt, mode });
        runIdRef.current = created.runId;
        openStream(created.runId);
        return created.runId;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          router.replace("/login");
          return null;
        }
        setView({
          ...EMPTY,
          prompt,
          status: "FAILED",
          error: {
            code: "CREATE_FAILED",
            message:
              error instanceof Error
                ? error.message
                : "Could not start the run",
          },
        });
        return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [close, router, openStream],
  );

  const cancel = useCallback(
    async (runId: string | null) => {
      if (!runId) {
        close();
        return;
      }
      await runs.cancel(runId).catch(() => undefined);
    },
    [close],
  );

  useEffect(() => close, [close]);

  return {
    view,
    start,
    cancel,
    reset,
    close,
    reopen: openStream,
    runIdRef,
  } as const;
}
