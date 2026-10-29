"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import {
  CheckCircle2,
  CircleX,
  Terminal,
  Wrench,
  Loader2,
  Ban,
  GitPullRequestArrow,
  PencilLine,
  GitBranch,
  X,
  HelpCircle,
} from "lucide-react";
import PromptBar, { type PromptBarSendDetail } from "@/components/PromptBar";
import ThoughtLine from "@/components/ThoughtLine";
import { announceRun } from "@/lib/use-sessions";
import { useRunStream } from "@/lib/use-run";
import {
  ApiError,
  conversations,
  github,
  runs,
  type ConversationMessage,
  type GithubRepoItem,
} from "@/lib/api";
import { useSearchParams, useRouter } from "next/navigation";

const COMMANDS = [
  {
    key: "fix",
    name: "/fix",
    description: "Run in FIX mode patch the codebase in place",
  },
];

const SOURCES = [
  {
    key: "repo",
    name: "GitHub repo",
    description: "Attach one of your repositories",
    attach: true,
  },
];

const REPO_FULL_NAME_RE = /^[\w.-]+\/[\w.-]+$/;
const NEGATIVE_REPLY_RE = /^\s*(no|n|nope|deny|declined?|reject(ed)?|cancel)\b/i;

export function AgentConsole({
  conversationId,
}: {
  conversationId: string | null;
}) {
  const {
    view,
    setView,
    start,
    sendToConversation,
    cancel,
    reset,
    reopen,
    runIdRef,
  } = useRunStream();
  const searchParams = useSearchParams();
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [draftTask, setDraftTask] = useState<string | null>(null);
  const [history, setHistory] = useState<ConversationMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const resumedRunRef = useRef<string | null>(null);
  const loadedConversationRef = useRef<string | null>(null);
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);
  const [repoList, setRepoList] = useState<GithubRepoItem[] | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const attachResolveRef = useRef<((files?: string | string[]) => void) | null>(
    null,
  );
  const [answering, setAnswering] = useState(false);
  const [askNote, setAskNote] = useState("");
  const [answerError, setAnswerError] = useState<string | null>(null);

  const working = view.status === "QUEUED" || view.status === "RUNNING";
  const toolLines = view.tools;

  // Load a conversation thread (sidebar link → /agent/:conversationId).
  useEffect(() => {
    const taskParam = searchParams.get("task");
    if (taskParam && draftTask === null) setDraftTask(taskParam);
    if (
      !conversationId ||
      loadedConversationRef.current === conversationId
    )
      return;
    loadedConversationRef.current = conversationId;
    setLoadingHistory(true);
    conversations
      .get(conversationId)
      .then(({ conversation }) => {
        setHistory(conversation.messages);
        reset();
        // Re-attach to the latest run when it is still in flight so the
        // SSE endpoint replays everything published so far.
        const active = conversation.runs.find(
          (r) => r.status === "QUEUED" || r.status === "RUNNING",
        );
        const lastUser = [...conversation.messages]
          .reverse()
          .find((m) => m.role === "USER");
        if (active) {
          runIdRef.current = active.id;
          setView((prev) => ({
            ...prev,
            prompt: lastUser?.content ?? "",
            status: "QUEUED",
          }));
          reopen(active.id);
        } else {
          runIdRef.current = null;
          setView((prev) => ({ ...prev, prompt: lastUser?.content ?? "" }));
        }
      })
      .catch(() => undefined)
      .finally(() => setLoadingHistory(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, searchParams]);

  // Resume a live/finished run stream (?run= link).
  useEffect(() => {
    const runParam = searchParams.get("run");
    if (!runParam || resumedRunRef.current === runParam) return;
    resumedRunRef.current = runParam;
    runs
      .get(runParam)
      .then(({ run }) => {
        setView((prev) => ({ ...prev, prompt: run.prompt }));
        runIdRef.current = runParam;
        reopen(runParam);
      })
      .catch(() => undefined);
  }, [searchParams, reopen, runIdRef, setView]);

  // Entrance animation for the intro header.
  useEffect(() => {
    if (headerRef.current || view.prompt || history.length > 0) return;
    const ctx = gsap.context(() => {
      gsap.from(".hero-line", {
        y: 26,
        opacity: 0,
        stagger: 0.12,
        duration: 0.8,
        ease: "power3.out",
      });
    }, headerRef);
    return () => ctx.revert();
  }, [view.prompt, history.length]);

  // Message stagger on new content.
  useEffect(() => {
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
  }, [view.tools.length, view.texts.length, view.summary, history.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [
    view.tools.length,
    view.texts.length,
    view.summary,
    history.length,
    view.streamingText,
  ]);

  useEffect(() => {
    if (working) {
      const id = window.setInterval(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      }, 320);
      return () => window.clearInterval(id);
    }
  }, [working]);

  // After the run finishes, store the agent reply in history locally and
  // refresh the sidebar (the worker persisted the AGENT message).
  useEffect(() => {
    if (view.status === "SUCCEEDED" && view.summary) {
      setHistory((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "AGENT" && last.content === view.summary) return prev;
        return [
          ...prev,
          {
            id: `local-${prev.length}`,
            role: "AGENT",
            content: view.summary ?? "",
            runId: runIdRef.current,
            createdAt: new Date().toISOString(),
          },
        ];
      });
      announceRun();
    }
    if (view.status === "FAILED" || view.status === "CANCELLED") {
      announceRun();
    }
  }, [view.status, view.summary, runIdRef]);

  // ── Repo picker (PromptBar "@GitHub repo" source → attach chip) ──────
  const openRepoPicker = useCallback(() => {
    attachResolveRef.current?.();
    attachResolveRef.current = null;
    setRepoPickerOpen(true);
    setRepoList(null);
    setRepoError(null);
    github
      .repos()
      .then((repos) => setRepoList(repos))
      .catch((error: unknown) => {
        setRepoError(
          error instanceof ApiError
            ? error.message
            : "Could not load your repositories",
        );
        setRepoList([]);
      });
  }, []);

  const closeRepoPicker = useCallback(() => {
    setRepoPickerOpen(false);
    attachResolveRef.current?.();
    attachResolveRef.current = null;
  }, []);

  const pickRepo = useCallback((fullName: string) => {
    setRepoPickerOpen(false);
    const resolve = attachResolveRef.current;
    attachResolveRef.current = null;
    resolve?.(fullName);
  }, []);

  /** PromptBar calls this when the user picks the repo source; we open our own
   * picker and resolve with the chosen owner/repo (it becomes an attachment
   * chip, and onSend passes it along as repoFullName). */
  const onAttach = useCallback((): Promise<string | string[] | void> => {
    openRepoPicker();
    return new Promise<string | string[] | void>((resolve) => {
      attachResolveRef.current = resolve;
    });
  }, [openRepoPicker]);

  // ── Ask answers (Approve / Decline / options / free-text) ────────────
  const answerAsk = useCallback(
    (payload: { approved: boolean; note?: string }) => {
      const ask = view.ask;
      const runId = runIdRef.current;
      if (!ask || !runId || answering) return;
      setAnswering(true);
      setAnswerError(null);
      runs
        .answer(runId, { askId: ask.askId, ...payload })
        .then(() => {
          setView((prev) => ({ ...prev, ask: null }));
          setAskNote("");
        })
        .catch((error: unknown) => {
          setAnswerError(
            error instanceof ApiError
              ? error.message
              : "Could not send your answer",
          );
        })
        .finally(() => setAnswering(false));
    },
    [view.ask, answering, runIdRef, setView],
  );

  const onSend = useCallback(
    (text: string, detail: PromptBarSendDetail) => {
      const mode = text.trim().startsWith("/fix") ? "FIX" : "CREATE";
      const cleaned = text.replace(/^\/\w+\s*/g, "").trim();
      const repoFullName =
        detail.attachments
          .map((attachment) => attachment.trim())
          .find((attachment) => REPO_FULL_NAME_RE.test(attachment)) ?? undefined;
      setDraftTask(null);
      setHistory((prev) => [
        ...prev,
        {
          id: `local-user-${prev.length}`,
          role: "USER",
          content: cleaned,
          runId: null,
          createdAt: new Date().toISOString(),
        },
      ]);
      if (conversationId !== null) {
        void sendToConversation(conversationId, cleaned, mode, repoFullName).then(
          (created) => {
            if (created) announceRun();
          },
        );
      } else {
        runIdRef.current = null;
        void start(cleaned, mode, repoFullName).then((created) => {
          runIdRef.current = created?.runId ?? null;
          if (created) {
            announceRun();
            // Move to the conversation route; the console remounts there,
            // reloads history, and re-attaches to the in-flight run.
            router.push(`/agent/${created.conversationId}`);
          }
        });
      }
    },
    [start, sendToConversation, conversationId, runIdRef, router],
  );

  const onStop = useCallback(() => {
    cancel(runIdRef.current);
  }, [cancel, runIdRef]);

  const onNewConversation = useCallback(() => {
    router.push("/agent");
  }, [router]);

  const showIntro =
    !view.prompt && history.length === 0 && !loadingHistory;

  return (
    <div className="relative flex h-[calc(100vh-3.4rem)] min-w-0 flex-col w-full">
      {/* subtle grid backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgba(0,0,0,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.03)_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]"
      />

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-8 md:px-8 w-full"
      >
        {showIntro ? (
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
            {history.map((message) => (
              <ChatBubble
                key={message.id}
                role={message.role}
                content={message.content}
              />
            ))}

            {view.workspace === "starting" && (
              <div className="stream-row flex items-center gap-3 rounded-2xl border border-orange-200/70 bg-orange-50/40 px-4 py-3 text-sm text-orange-700">
                <Loader2 className="size-4 animate-spin text-orange-500" />
                Starting your workspace… (first run in this session can take a
                moment)
              </div>
            )}
            {view.workspace === "ready" && (
              <div className="stream-row flex items-center gap-2 text-xs text-neutral-400">
                <CheckCircle2 className="size-3.5 text-emerald-500" />
                workspace ready
              </div>
            )}

            {view.reasonings.map((r, i) => (
              <details
                key={`r-${i}`}
                className="stream-row rounded-xl border border-neutral-200/60 bg-neutral-50/60 px-4 py-2 text-xs text-neutral-500"
              >
                <summary className="cursor-pointer select-none font-medium">
                  reasoning
                </summary>
                <p className="mt-2 whitespace-pre-wrap leading-relaxed">{r}</p>
              </details>
            ))}
            {view.streamingReasoning && (
              <div className="stream-row rounded-xl border border-neutral-200/60 bg-neutral-50/60 px-4 py-2 text-xs italic text-neutral-400">
                <span className="not-italic font-medium">reasoning…</span>
                <p className="mt-1 whitespace-pre-wrap leading-relaxed">
                  {view.streamingReasoning.slice(-1200)}
                </p>
              </div>
            )}

            <ThoughtLine
              working={working}
              steps={toolLines.map((t) => t.name)}
              label={working ? "Working..." : ""}
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
                  {t.status === "running" ? (
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
                    {t.status === "done" && (
                      <CheckCircle2 className="size-3.5 text-emerald-500" />
                    )}
                    {t.status === "error" && (
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

            {view.edits.map((e) => (
              <div
                key={e.path}
                className="stream-row flex items-center gap-2 text-xs text-neutral-500"
              >
                <PencilLine className="size-3.5 text-orange-400" />
                <span className="font-mono">{e.path}</span>
                {e.state === "done" && (
                  <CheckCircle2 className="size-3 text-emerald-500" />
                )}
                {e.state === "error" && <CircleX className="size-3 text-red-500" />}
              </div>
            ))}

            {view.texts.map((text, i) => (
              <div
                key={`t-${i}`}
                className="stream-row whitespace-pre-wrap rounded-2xl border border-neutral-200/70 bg-white px-4 py-3 text-sm leading-relaxed text-neutral-800 shadow-sm"
              >
                {text}
              </div>
            ))}
            {view.streamingText && (
              <div className="stream-row whitespace-pre-wrap rounded-2xl border border-neutral-200/70 bg-white px-4 py-3 text-sm leading-relaxed text-neutral-800 shadow-sm">
                {view.streamingText}
                <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-orange-400 align-middle" />
              </div>
            )}

            {view.ask && working && (
              <div className="stream-row rounded-2xl border border-orange-300/70 bg-orange-50/70 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-medium text-orange-700">
                  <HelpCircle className="size-4" />
                  Kairo needs your answer
                  {answering && (
                    <Loader2 className="size-3.5 animate-spin text-orange-500" />
                  )}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-neutral-800">
                  {view.ask.question}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {view.ask.options?.map((option) => (
                    <button
                      key={option}
                      type="button"
                      disabled={answering}
                      onClick={() =>
                        answerAsk({
                          approved: !NEGATIVE_REPLY_RE.test(option),
                          note: option,
                        })
                      }
                      className="cursor-pointer rounded-full border border-orange-300 bg-white px-3 py-1 text-xs font-medium text-orange-700 transition-colors hover:bg-orange-100 disabled:opacity-50"
                    >
                      {option}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={answering}
                    onClick={() => answerAsk({ approved: true })}
                    className="cursor-pointer rounded-full bg-emerald-500 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-400 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={answering}
                    onClick={() => answerAsk({ approved: false })}
                    className="cursor-pointer rounded-full bg-white px-3 py-1 text-xs font-medium text-neutral-500 ring-1 ring-neutral-300 transition-colors hover:text-neutral-700 disabled:opacity-50"
                  >
                    Decline
                  </button>
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    value={askNote}
                    onChange={(event) => setAskNote(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        const note = askNote.trim();
                        answerAsk({ approved: true, ...(note ? { note } : {}) });
                      }
                    }}
                    placeholder="or type a reply…"
                    disabled={answering}
                    className="min-w-0 flex-1 rounded-xl border border-orange-200 bg-white px-3 py-1.5 text-sm text-neutral-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-orange-400"
                  />
                  <button
                    type="button"
                    disabled={answering}
                    onClick={() => {
                      const note = askNote.trim();
                      answerAsk({ approved: true, ...(note ? { note } : {}) });
                    }}
                    className="cursor-pointer rounded-xl bg-orange-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-orange-400 disabled:opacity-50"
                  >
                    reply
                  </button>
                </div>
                {answerError && (
                  <p className="mt-2 text-xs text-red-500">{answerError}</p>
                )}
              </div>
            )}

            {view.summary && view.status === "SUCCEEDED" && (
              <div className="stream-row rounded-2xl border border-emerald-200/70 bg-emerald-50/40 p-5 shadow-sm">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="size-4 text-emerald-600" />
                  <span className="text-emerald-700">Run finished</span>
                </div>
                {view.prUrl && (
                  <a
                    href={view.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-300/70 bg-white px-3 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50"
                  >
                    <GitPullRequestArrow className="size-3.5" />
                    View pull request
                  </a>
                )}
                {(view.tokensIn !== null || view.tokensOut !== null) && (
                  <p className="mt-1 text-xs text-neutral-400">
                    {view.tokensIn ?? 0} in / {view.tokensOut ?? 0} out tokens
                  </p>
                )}
              </div>
            )}

            {(view.status === "FAILED" || view.status === "CANCELLED") && (
              <div className="stream-row rounded-2xl border border-red-200/70 bg-red-50/40 p-5 shadow-sm">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  {view.status === "FAILED" ? (
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
                {view.error && (
                  <p className="font-mono text-xs text-neutral-500">
                    {view.error.code}: {view.error.message}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 pb-5 pt-2 md:px-8 w-full">
        <div className="mx-auto max-w-3xl w-full">
          {draftTask && !working && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-orange-200/70 bg-orange-50/60 px-3.5 py-2 text-xs text-orange-700">
              <span className="font-medium">draft task</span>
              <span
                className="line-clamp-2 flex-1 font-mono"
                style={{
                  WebkitLineClamp: 2,
                  display: "-webkit-box",
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {draftTask}
              </span>
              <button
                type="button"
                onClick={() => onSend(draftTask, { attachments: [] })}
                className="cursor-pointer rounded-full bg-orange-500 px-2.5 py-0.5 font-medium text-white transition-colors hover:bg-orange-400"
              >
                run this
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftTask(null);
                }}
                className="cursor-pointer rounded-full bg-white px-2.5 py-0.5 font-medium text-neutral-500 transition-colors hover:text-neutral-700"
              >
                dismiss
              </button>
            </div>
          )}
          {history.length > 0 && (
            <div className="mb-2 flex items-center gap-2 text-xs text-neutral-400">
              <Terminal className="size-3.5" />
              {working
                ? "agent is running — new tasks wait until this one finishes"
                : conversationId
                  ? "continuing this conversation"
                  : ""}
              {working && (
                <button
                  type="button"
                  onClick={onStop}
                  className="ml-2 rounded-full bg-red-50 px-2.5 py-0.5 font-medium text-red-600 transition-colors hover:bg-red-100"
                >
                  stop run
                </button>
              )}
              {!working && (
                <button
                  type="button"
                  onClick={onNewConversation}
                  className="ml-auto rounded-full bg-neutral-100 px-2.5 py-0.5 font-medium text-neutral-600 transition-colors hover:bg-neutral-200"
                >
                  new chat
                </button>
              )}
            </div>
          )}
          <div className="relative">
            {repoPickerOpen && (
              <div className="absolute bottom-full left-0 z-30 mb-2 w-full max-w-xs overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-lg">
                <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-500">
                    <GitBranch className="size-3.5" />
                    Attach a repository
                  </span>
                  <button
                    type="button"
                    aria-label="Close repository picker"
                    onClick={closeRepoPicker}
                    className="cursor-pointer text-neutral-400 transition-colors hover:text-neutral-600"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto p-1.5">
                  {repoError && (
                    <p className="px-2.5 py-3 text-xs text-red-500">
                      {repoError}
                    </p>
                  )}
                  {!repoError && repoList === null && (
                    <div className="flex items-center gap-2 px-2.5 py-3 text-xs text-neutral-400">
                      <Loader2 className="size-3.5 animate-spin" />
                      loading repositories…
                    </div>
                  )}
                  {!repoError &&
                    repoList !== null &&
                    repoList.length === 0 && (
                      <p className="px-2.5 py-3 text-xs text-neutral-400">
                        No repositories found.
                      </p>
                    )}
                  {repoList?.map((repo) => (
                    <button
                      key={repo.fullName}
                      type="button"
                      onClick={() => pickRepo(repo.fullName)}
                      className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-sm text-neutral-700 transition-colors hover:bg-orange-50"
                    >
                      <span className="truncate font-mono text-[13px]">
                        {repo.fullName}
                      </span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-neutral-400">
                        {repo.push
                          ? repo.private
                            ? "private"
                            : "public"
                          : "read-only"}
                      </span>
                    </button>
                  ))}
                </div>
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
              models={[]}
              efforts={[]}
              busy={working}
              onSend={onSend}
              onStop={onStop}
              onAttach={onAttach}
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
    </div>
  );
}

function ChatBubble({ role, content }: { role: string; content: string }) {
  if (role === "USER") {
    return (
      <div className="stream-row flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-neutral-950 px-4 py-3 text-sm text-white shadow-sm">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="stream-row whitespace-pre-wrap rounded-2xl border border-neutral-200/70 bg-white px-4 py-3 text-sm leading-relaxed text-neutral-800 shadow-sm">
      {content}
    </div>
  );
}
