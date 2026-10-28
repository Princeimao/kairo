# R1 audit — OpenCode harness refactor (`refactor/opencode-harness`)

> **Status: COMPLETE** (R1–R6 committed; live smoke testing was run locally and
> is summarized at the bottom). Goal achieved: `@kairo/agent` is gone; OpenCode
> runs inside each user's sandbox container and the API/worker only orchestrate.

Goal: replace the custom LLM loop (`@kairo/agent`) with **OpenCode running inside each
user's sandbox container**; API/worker only orchestrate. OpenCode version pinned:
`opencode-ai@1.19.5` / `@opencode-ai/sdk@1.19.5`.

Legend: **KEEP** (unchanged), **REWRITE** (same responsibility, new mechanism),
**DELETE** (dead after refactor), **NEW** (to be added).

## apps/api

| Path | Action | Reason |
| --- | --- | --- |
| `src/app.ts` | KEEP (+ mounts) | Boot; will mount LLM proxy routes wiring only |
| `src/config/env.ts` | REWRITE | Drop nothing yet; add `SANDBOX_SECRET`, `REDIS_URL`, `LLM_PROXY_*`, `OPENCODE_*`; AGENT_* never lived here (agent package had its own loader) |
| `src/lib/runs/executor.ts` | DELETE | Inline agent runner — replaced by BullMQ enqueue |
| `src/lib/runs/registry.ts` | DELETE | In-process SSE registry — replaced by Redis pub/sub + DB replay |
| `src/routes/runs.ts` | REWRITE | Same REST shape (`POST /`, `GET /`, `GET /:id`, `POST /:id/cancel`, `GET /:id/events`); POST enqueues job + creates Message/Conversation; events endpoint replays AgentStep then relays Redis |
| `src/routes/sandbox.ts` | KEEP | Container lifecycle routes |
| `src/routes/github.ts` | KEEP | Webhook + events feed |
| `src/routes/auth.ts` | KEEP | GitHub App OAuth flow |
| `src/middleware/*` | KEEP | auth/error/rate-limit |
| `src/lib/github.ts` | KEEP | Token store used by worker host-side GitHub flow |
| `src/lib/session.ts`, `crypto.ts` | KEEP | Auth sessions, secret encryption |
| `src/lib/runs/*` (after rewrite) | NEW | `lib/queue.ts` (BullMQ producer), `lib/relay.ts` (Redis SSE relay), `lib/sessions.ts` (chat session/conversation routes) |
| `src/llm/proxy.ts` | NEW | Per-sandbox token-gated SSE-pass-through LLM proxy (R4) |

## apps/web

| Path | Action | Reason |
| --- | --- | --- |
| `src/lib/api.ts` | REWRITE | `AgentEvent` union → normalized step events (text/reasoning/tool/edit/error/done/workspace); add `sessions` client (ChatSession/Conversation/Message) |
| `src/lib/use-run.ts` | REWRITE | Drop plan/replan reducer cases; handle `workspace` cold-start + new step types |
| `src/lib/use-sessions.ts` | REWRITE | Poll `/api/sessions` (conversations inside), keep runs-changed event for status dots |
| `src/lib/use-github-events.ts` | KEEP | Events feed |
| `src/components/kairo-sidebar.tsx` | REWRITE | Sessions group → session → conversation list (multi-conversation UI) |
| `src/app/(app)/agent/page.tsx` | REWRITE | Remove plan UI (`approach`, `replans`), render messages history, "starting your workspace" state |
| `src/app/(app)/dashboard/page.tsx`, `(auth)`, `(onboarding)`, `landing` | KEEP | Unrelated |
| `src/components/PromptBar.tsx`, `ThoughtLine.tsx` | REWRITE (small) | Strip planner/executor model labels; model picker stays cosmetic-or-removed |

## packages/agent — DELETE entirely (R2)

| Path | Reason |
| --- | --- |
| `src/agent/{loop,events}.ts` | Custom ReAct loop — OpenCode is the harness |
| `src/tools/*` | Hand-rolled exec/file tools — OpenCode tools + permissions |
| `src/prompts.ts`, `src/models.ts` | Prompt shaping / model registry — config template |
| `src/workspace/*` | Workspace contract — sandbox package owns container ops |
| `src/config/env.ts` | `loadAgentEnv` — NEBIUS key now read by API env for proxy |
| `src/cli/*` (try, offline:check, model:check) | Probes; superseded by `opencode debug` + R7 live test |
| deps `ai`, `@ai-sdk/openai-compatible`, `zod` | Unused after deletion |

## packages/sandbox

| Path | Action | Reason |
| --- | --- | --- |
| `src/sandbox.ts` | REWRITE | Delete Workspace contract (`searchCode`, `listFiles` agent-facing); keep `ensureRunning`, `ensureVolume`, `exec`, `status`, `stop`, archive put/get; add per-user network isolation, `OPENCODE_SERVER_PASSWORD` env derivation, health-wait helper |
| `src/http-bypass.ts`, `archive.ts`, `docker.ts`, `config.ts` | KEEP | Low-level Docker HTTP helpers (tar/exec/inspect) |
| `src/config.ts` `WorkspaceError` | REWRITE | Error class moves here (was imported from `@kairo/agent`) |
| `sandbox/Dockerfile` | REWRITE | `npm i -g opencode-ai@1.19.5`, entrypoint `opencode serve`, XDG_* → /workspace/.kairo (volume-persisted state) |
| `src/cli/verify.ts` | REWRITE | Drop listFiles/searchCode checks; add opencode health check |
| `package.json` | REWRITE | Drop `@kairo/agent` dep |

## packages/db

| Path | Action | Reason |
| --- | --- | --- |
| `schema.prisma` AgentRun | KEEP + ADD | + `conversationId?`, `tokensIn/tokensOut`, `errorMessage?`, `repoFullName?`, `branch?`, `prUrl?` |
| `schema.prisma` AgentStep | KEEP | `type` is already free-form String (documented, not plan/replan-bound) |
| `schema.prisma` Sandbox | KEEP + ADD | + `llmTokenHash` (hashed per-sandbox LLM proxy token) |
| `schema.prisma` NEW `ChatSession`, `Conversation`, `Message` | NEW | Session (sidebar) → many Conversations (threads, 1:1 with OpenCode sessions via `opencodeSessionId`) → many Messages (USER/AGENT text) |
| `GithubEvent`, `User`, `GithubConnection`, `Session` | KEEP | — |

## NEW packages/apps

| Path | Reason |
| --- | --- |
| `packages/run-queue` | BullMQ queue/worker factories + job type `{runId}` shared by API (producer) and worker (consumer) |
| `apps/worker` | Run consumer: ensure container → OpenCode client → event mapping → steps/SSE → messages → GitHub flow |

## env vars

| Var | Action |
| --- | --- |
| `AGENT_*` (PLANNER/EXECUTOR MODEL, TOOL_MODE, MAX_STEPS, TIME_BUDGET_MS) | DELETE from `.env`/examples — model now chosen by proxy config allowlist |
| `NEBIUS_API_KEY`, `NEBIUS_BASE_URL` | KEEP — consumed by LLM proxy |
| `SANDBOX_SECRET` | NEW — HMAC source for per-container OpenCode server password + LLM token hashing |
| `REDIS_URL` | NEW — queue + SSE relay |
| `LLM_PROXY_PORT`, `LLM_PROXY_HOST`, `LLM_PROXY_URL` (in-container base) | NEW |
| `OPENCODE_MODEL` / allowlist | NEW — default model passed to OpenCode + proxy allowlist |

## Deleted lines accounting (final, vs `main`)

- `packages/agent/**` — entire package deleted: **2,715 lines** across 19 files
  (loop 520, local workspace 494, offline-check 437, model-check 205,
  executors 201, try CLI 164, …).
- `apps/api` — `executor.ts` (−160), `registry.ts` (−95); `routes/runs.ts`
  rewritten queue-first (−142/+151).
- `packages/sandbox` — Workspace contract + agent-facing `listFiles`/`searchCode`
  removed (−176/+154 net in `sandbox.ts`), `cli/verify.ts` slimmed (−20).
- `apps/web` — plan/replan UI removed; `agent/page.tsx` and `use-run.ts`
  rewritten for the RunEvent union (net −164 in those two files' old logic).
- Whole branch: 81 files changed, **+8,934 / −3,749** (includes new
  `apps/worker`, `packages/run-queue`, LLM proxy, sessions UI).

## Live verification notes

- Container image: `opencode serve --hostname 0.0.0.0 --port 4096` with
  `OPENCODE_SERVER_PASSWORD` basic auth; `/global/health` → `{"healthy":true,"version":"1.19.5"}`.
- `OPENCODE_CONFIG=/workspace/.kairo/config/opencode.json` is read (proven via
  deliberate parse error); all XDG dirs resolve under `/workspace/.kairo/*`.
- Worker env fallback (`apps/api/.env`) path had a one-level-too-high resolve
  bug (`env.ts`) — fixed during the smoke run.
