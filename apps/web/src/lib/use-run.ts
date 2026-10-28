"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, conversations, runs, type AgentEvent, type RunStatus } from "@/lib/api";

export type ToolStep = {
  id: string;
  name: string;
  status: "running" | "done" | "error";
  input: unknown;
  output: string | null;
};

export type RunView = {
  status: RunStatus | "IDLE";
  prompt: string;
  workspace: "starting" | "ready" | null;
  texts: string[];
  streamingText: string | null;
  reasonings: string[];
  streamingReasoning: string | null;
  tools: ToolStep[];
  edits: { path: string; state: "running" | "done" | "error" }[];
  summary: string | null;
  prUrl: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  error: { code: string; message: string } | null;
};

const EMPTY: RunView = {
  status: "IDLE",
  prompt: "",
  workspace: null,
  texts: [],
  streamingText: null,
  reasonings: [],
  streamingReasoning: null,
  tools: [],
  edits: [],
  summary: null,
  prUrl: null,
  tokensIn: null,
  tokensOut: null,
  error: null,
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

function toolId(event: AgentEvent & { type: "tool" }, index: number): string {
  return event.callId ?? `${event.name}:${index}`;
}

export function useRunStream() {
  const router = useRouter();
  const [view, setView] = useState<RunView>(EMPTY);
  const sourceRef = useRef<EventSource | null>(null);
  const runIdRef = useRef<string | null>(null);
  const toolIndexRef = useRef(0);

  const close = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const reset = useCallback(() => {
    close();
    setView(EMPTY);
    toolIndexRef.current = 0;
  }, [close]);

  const apply = useCallback(
    (event: AgentEvent) => {
      setView((prev) => {
        switch (event.type) {
          case "workspace":
            return { ...prev, status: "RUNNING", workspace: event.state };
          case "text":
            if (event.done) {
              const text = event.text.trim();
              return {
                ...prev,
                texts: text === "" ? prev.texts : [...prev.texts, text],
                streamingText: null,
              };
            }
            return { ...prev, status: "RUNNING", streamingText: event.text };
          case "reasoning":
            if (event.done) {
              const text = event.text.trim();
              return {
                ...prev,
                reasonings:
                  text === "" ? prev.reasonings : [...prev.reasonings, text],
                streamingReasoning: null,
              };
            }
            return {
              ...prev,
              status: "RUNNING",
              streamingReasoning: event.text,
            };
          case "tool": {
            const id = toolId(event, toolIndexRef.current);
            toolIndexRef.current += 1;
            const tools = [...prev.tools];
            const idx = tools.findIndex((t) => t.id === id);
            const step: ToolStep = {
              id,
              name: event.name,
              status: event.state,
              input: event.input,
              output: event.output ?? null,
            };
            if (idx === -1) tools.push(step);
            else tools[idx] = step;
            return { ...prev, status: "RUNNING", tools };
          }
          case "edit": {
            const edits = [...prev.edits];
            const idx = edits.findIndex((e) => e.path === event.path);
            const edit = {
              path: event.path,
              state: event.state ?? "running",
            };
            if (idx === -1) edits.push(edit);
            else edits[idx] = edit;
            return { ...prev, status: "RUNNING", edits };
          }
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
              prUrl: event.prUrl ?? null,
              tokensIn: event.tokensIn ?? prev.tokensIn,
              tokensOut: event.tokensOut ?? prev.tokensOut,
              streamingText: null,
              streamingReasoning: null,
              error: event.error ?? prev.error,
            };
          default:
            return prev;
        }
      });
      if (event.type === "done") close();
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
          prev.status === "QUEUED" || prev.status === "RUNNING"
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

  /** Start a brand-new conversation + run (POST /runs). */
  const start = useCallback(
    async (prompt: string, mode: "CREATE" | "FIX" = "CREATE") => {
      close();
      setView({ ...EMPTY, prompt, status: "QUEUED" });
      try {
        const created = await runs.create({ prompt, mode });
        runIdRef.current = created.runId;
        openStream(created.runId);
        return created;
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

  /** Continue an existing conversation (POST /conversations/:id/messages). */
  const sendToConversation = useCallback(
    async (
      conversationId: string,
      prompt: string,
      mode: "CREATE" | "FIX" = "CREATE",
    ) => {
      close();
      setView({ ...EMPTY, prompt, status: "QUEUED" });
      try {
        const created = await conversations.message(conversationId, {
          prompt,
          mode,
        });
        runIdRef.current = created.runId;
        openStream(created.runId);
        return created;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          router.replace("/login");
          return null;
        }
        setView((prev) => ({
          ...prev,
          status: "FAILED",
          error: {
            code: "CREATE_FAILED",
            message:
              error instanceof Error
                ? error.message
                : "Could not send the message",
          },
        }));
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
    setView,
    start,
    sendToConversation,
    cancel,
    reset,
    close,
    reopen: openStream,
    runIdRef,
  } as const;
}
