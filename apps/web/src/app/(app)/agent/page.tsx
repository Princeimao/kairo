"use client";

import * as React from "react";
import { gsap } from "gsap";
import {
  CheckCircle2,
  CircleX,
  Terminal,
  Wand2,
  Wrench,
  Loader2,
  ChevronsRight,
  Ban,
} from "lucide-react";
import PromptBar, { type PromptBarSendDetail } from "@/components/PromptBar";
import ThoughtLine from "@/components/ThoughtLine";
import { useRunStream } from "@/lib/use-run";
import { runs } from "@/lib/api";

const MODELS = [
  { key: "nemotron-nano", name: "Nemotron 3 Nano", tag: "planner" },
  { key: "nemotron-super", name: "Nemotron 3 Super", tag: "executor" },
];

const COMMANDS = [
  {
    key: "fix",
    name: "/fix",
    description: "Run in FIX mode patch the codebase in place",
  },
  {
    key: "plan",
    name: "/plan",
    description: "Describe the approach before touching files",
  },
];

const SOURCES = [
  {
    key: "repo",
    name: "GitHub repo",
    description: "Your repositories",
    attach: false,
  },
];

export default function AgentPage() {
  const { view, start, cancel, reset, reopen, runIdRef } = useRunStream();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const streamRef = React.useRef<HTMLDivElement>(null);
  const headerRef = React.useRef<HTMLDivElement>(null);
  const [activeRunPrompt, setActiveRunPrompt] = React.useState<string | null>(
    null,
  );
  const resumedRef = React.useRef(false);

  const streaming = activeRunPrompt !== null && view.status === "RUNNING";

  // Resume an in-flight run after a page reload.
  React.useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    runs
      .list()
      .then((all) => {
        const open = all.find((r) => r.status === "RUNNING");
        if (open) {
          runIdRef.current = open.id;
          setActiveRunPrompt(open.prompt);
          reopen(open.id);
        }
      })
      .catch(() => undefined);
  }, [reopen, runIdRef]);

  // Entrance animation for the intro header.
  React.useEffect(() => {
    if (!headerRef.current || activeRunPrompt) return;
    const ctx = gsap.context(() => {
      gsap.from(".hero-line", {
        y: 26,
        opacity: 0,
        stagger: 0.12,
        duration: 0.8,
        ease: "power3.out",
      });
      gsap.from(".hero-flash", {
        scale: 0.6,
        opacity: 0,
        duration: 1.1,
        ease: "elastic.out(1, 0.5)",
        delay: 0.3,
      });
    }, headerRef);
    return () => ctx.revert();
  }, [activeRunPrompt]);

  // Message stagger on new content.
  React.useEffect(() => {
    if (!streamRef.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        gsap.utils.toArray<HTMLElement>(".stream-row", streamRef.current!),
        { willChange: "transform, opacity" },
        {
          y: 0,
          opacity: 1,
          duration: 0.55,
          ease: "power3.out",
          stagger: 0.04,
          overwrite: "auto",
        },
      );
    }, streamRef);
    return () => ctx.revert();
  }, [view.tools.length, view.texts.length, view.summary]);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view.tools.length, view.texts.length, view.summary]);

  React.useEffect(() => {
    if (streaming) {
      const id = window.setInterval(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      }, 320);
      return () => window.clearInterval(id);
    }
  }, [streaming]);

  const onSend = React.useCallback(
    (text: string, detail: PromptBarSendDetail) => {
      const mode = text.trim().startsWith("/fix") ? "FIX" : "CREATE";
      const cleaned = text.replace(/^\/\w+\s*/g, "").trim();
      setActiveRunPrompt(cleaned);
      runIdRef.current = null;
      void start(cleaned, mode === "FIX" ? "FIX" : "CREATE").then((id) => {
        runIdRef.current = id;
      });
      void detail;
    },
    [start, runIdRef],
  );

  const onStop = React.useCallback(() => {
    cancel(runIdRef.current);
    setActiveRunPrompt(null);
  }, [cancel]);

  const working =
    view.status === "RUNNING" || (view.status === "WAITING" && !view.error);
  const toolLines = view.tools;

  return (
    <div className="relative flex h-[calc(100vh-3.4rem)] min-w-0 flex-col">
      {/* subtle grid backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgba(0,0,0,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.03)_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]"
      />

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-8 md:px-8"
      >
        {!activeRunPrompt && !view.summary ? (
          <div
            ref={headerRef}
            className="mx-auto mt-24 flex max-w-2xl flex-col items-center text-center"
          >
            <img
              src="/kairo_logo.jpg"
              alt="logo"
              className="size-full object-cover h-16 w-16"
            />
            <h1 className="hero-line text-3xl font-semibold tracking-tight text-neutral-950 md:text-5xl">
              Put your ideas
            </h1>
            <h1 className="hero-line mb-3 text-3xl font-semibold tracking-tight text-orange-500 md:text-5xl">
              to work.
            </h1>
            <p className="hero-line max-w-md text-balance text-sm text-neutral-500">
              Give Kairo a task. It can research, browse the web, work with
              files, and use your custom skills, all from its own isolated
              environment.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-5" ref={streamRef}>
            {activeRunPrompt && (
              <div className="stream-row flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-neutral-950 px-4 py-3 text-sm text-white shadow-sm">
                  {activeRunPrompt}
                </div>
              </div>
            )}

            {view.approach && (
              <div className="stream-row rounded-2xl border border-neutral-200/70 bg-white p-4 shadow-sm">
                <div className="mb-2 text-[11px] font-medium uppercase tracking-widest text-orange-500">
                  approach
                </div>
                <p className="text-sm leading-relaxed text-neutral-700">
                  {view.approach}
                </p>
                <ul className="mt-3 space-y-1.5">
                  {view.planGoals.map((g, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm text-neutral-600"
                    >
                      <ChevronsRight className="mt-0.5 size-3.5 shrink-0 text-orange-500" />
                      <span>{g}</span>
                    </li>
                  ))}
                </ul>
                {view.replans.length > 0 && (
                  <div className="mt-2 text-xs text-neutral-400">
                    {view.replans.length > 0
                      ? `${view.replans.length} replan(s)`
                      : ""}
                  </div>
                )}
              </div>
            )}

            <ThoughtLine
              working={working}
              steps={toolLines.map(
                (t) =>
                  `${t.name}${t.durationMs !== null ? ` (${(t.durationMs / 1000).toFixed(1)}s)` : ""}`,
              )}
              label={activeRunPrompt ? "Workingâ€¦" : ""}
              doneLabel={
                toolLines.length
                  ? `Ran ${toolLines.length} tool call${toolLines.length === 1 ? "" : "s"}`
                  : ""
              }
              color="#111111"
              glyphColor="#f97316"
              fontSize={14}
              className="stream-row"
            />

            {toolLines.map((t) => (
              <div
                key={t.id}
                className="stream-row flex items-start gap-3 text-sm"
              >
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-neutral-200/70 bg-white text-neutral-400">
                  {t.status === "pending" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Wrench className="size-3.5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[13px] text-neutral-900">
                      {t.name}
                    </span>
                    {t.durationMs !== null && (
                      <span className="text-xs text-neutral-400">
                        {(t.durationMs / 1000).toFixed(1)}s
                      </span>
                    )}
                    {t.status === "ok" && (
                      <CheckCircle2 className="size-3.5 text-emerald-500" />
                    )}
                    {t.status === "failed" && (
                      <CircleX className="size-3.5 text-red-500" />
                    )}
                  </div>
                  {t.output && (
                    <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-neutral-950 p-3.5 font-mono text-[12px] leading-relaxed text-neutral-300">
                      {t.output}
                    </pre>
                  )}
                </div>
              </div>
            ))}

            {view.summary && (
              <div
                className={`stream-row rounded-2xl border p-5 shadow-sm ${
                  view.status === "SUCCEEDED"
                    ? "border-emerald-200/70 bg-emerald-50/40"
                    : view.status === "FAILED"
                      ? "border-red-200/70 bg-red-50/40"
                      : "border-neutral-200/70 bg-orange-50/40"
                }`}
              >
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  {view.status === "SUCCEEDED" ? (
                    <>
                      <CheckCircle2 className="size-4 text-emerald-600" />
                      <span className="text-emerald-700">Run finished</span>
                    </>
                  ) : view.status === "FAILED" ? (
                    <>
                      <CircleX className="size-4 text-red-600" />
                      <span className="text-red-700">Run failed</span>
                    </>
                  ) : (
                    <>
                      <Ban className="size-4 text-orange-600" />
                      <span className="text-orange-700">Run cancelled</span>
                    </>
                  )}
                </div>
                <p className="text-sm leading-relaxed text-neutral-700">
                  {view.summary}
                </p>
                {view.error && (
                  <p className="mt-2 font-mono text-xs text-neutral-400">
                    {view.error.code}: {view.error.message}
                  </p>
                )}
                {view.durationMs !== null && (
                  <p className="mt-3 text-xs text-neutral-400">
                    {view.durationMs / 1000}s Â· agent run
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 pb-5 pt-2 md:px-8">
        <div className="mx-auto max-w-3xl">
          {!activeRunPrompt && !view.summary ? null : (
            <div className="mb-2 flex items-center gap-2 text-xs text-neutral-400">
              <Terminal className="size-3.5" />
              {working
                ? "agent is running â€” new tasks wait until this one finishes"
                : "run complete â€” start another"}
              {working && (
                <button
                  type="button"
                  onClick={onStop}
                  className="ml-2 rounded-full bg-red-50 px-2.5 py-0.5 font-medium text-red-600 transition-colors hover:bg-red-100"
                >
                  stop run
                </button>
              )}
              {view.status !== "RUNNING" && !working && (
                <button
                  type="button"
                  onClick={() => {
                    reset();
                    setActiveRunPrompt(null);
                  }}
                  className="ml-auto rounded-full bg-neutral-100 px-2.5 py-0.5 font-medium text-neutral-600 transition-colors hover:bg-neutral-200"
                >
                  new task
                </button>
              )}
            </div>
          )}
          <PromptBar
            className="border rounded-3xl"
            placeholder={
              working
                ? "agent is busy wait for the run to finish"
                : "describe a task, e.g. /fix flaky login test"
            }
            sources={SOURCES}
            commands={COMMANDS}
            models={MODELS}
            defaultModel="nemotron-super"
            efforts={["quick", "standard", "deep"]}
            defaultEffort="standard"
            busy={working}
            onSend={onSend}
            onStop={onStop}
            width={720}
            radius={20}
            background="#ffffff"
            color="#171717"
            menuBackground="#ffffff"
            sparkColor="#f97316"
          />
        </div>
      </div>
    </div>
  );
}
