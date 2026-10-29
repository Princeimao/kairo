# Kairo

AI coding agent platform. Each user gets an isolated Docker workspace running
[OpenCode](https://opencode.ai) (`opencode-ai@1.19.5`); the API and worker only
orchestrate — OpenCode does the coding inside the container, and all LLM calls
go through a token-gated host-side proxy.

```
web (:3000) ──► api (:4000) ──► BullMQ (redis) ──► worker
                  │  ▲                                │
                  │  └── SSE relay ◄── pub/sub ◄──────┤
                  │                                    │
             LLM proxy (:4100) ◄───────────────────────┤
                  ▲                                    │
                  └── OpenCode SDK ──► sandbox container
                        (opencode serve, per-user network + volume)
```

- **Chat model:** `ChatSession` → many `Conversation` → many `Message`.
  A conversation maps 1:1 to an OpenCode session (`opencodeSessionId`), which
  survives container restarts via the volume-persisted `/workspace/.kairo`.
- **Runs:** `POST /runs` stores the USER message, enqueues `{runId, userId}`,
  and the worker drives OpenCode over the SDK: workspace events, streaming
  text/reasoning, tool calls, and a final reply persisted as the AGENT message.
- **LLM proxy:** the worker writes each container's `opencode.json` with a
  provider pointing at `http://host.docker.internal:4100/internal/llm/v1`;
  requests carry a per-container bearer token (HMAC-derived, only the hash is
  stored) and are checked against the active run + model allowlist.
- **GitHub:**
  - *Attached repo* (compose-box repo picker → `repoFullName`): the worker
    clones with the stored token, the agent edits `/workspace/repo`, then the
    worker pushes `kairo/<runId>` and opens a PR from the reply summary.
    Read-only access falls back to a fork + cross-repo PR.
  - *Fresh publish* (no attached repo): the agent asks for approval, then
    calls `POST /internal/actions/github/push`, which creates the repository
    and pushes `/workspace/repo` host-side. Walked through by the
    `github-publish` skill the harness writes into every workspace.
- **Asking the user:** `POST /internal/actions/ask` (sandbox bearer token,
  i.e. `$KAIRO_LLM_TOKEN` from the container) blocks up to 15 min until
  `POST /runs/:id/answers` writes the reply. The worker polls the pending
  marker and emits an `ask` SSE event, so the console shows the question with
  Approve / Decline / option / free-text reply while the agent waits.
- **Skills:** the worker writes `/workspace/.kairo/skills/*/SKILL.md`
  (`github-publish`, `software-engineer`) and enables them via OpenCode's
  `skills` config key; skill/config changes restart the container once so the
  server picks them up.

## Quick start

```sh
docker compose up -d          # Postgres + Redis
npm install
npm run db:migrate -w @kairo/db
npm run sandbox:build         # builds kairo-sandbox:latest (OpenCode inside)
cp .env.example apps/api/.env # fill in GitHub OAuth + NEBIUS_API_KEY etc.
npm run dev                   # api :4000, web :3000, worker :4001
```

- **Auth setup** (GitHub OAuth App, env vars, routes): [`docs/auth.md`](docs/auth.md)
- **Model/provider notes:** [`docs/model-notes.md`](docs/model-notes.md)
- **Refactor audit (OpenCode harness):** [`docs/refactor-opencode.md`](docs/refactor-opencode.md)

## Workspace layout

| Path | What it is |
| --- | --- |
| `apps/api` | Express API: auth, runs, sessions/conversations, GitHub webhooks, SSE relay, LLM proxy |
| `apps/worker` | BullMQ consumer: container lifecycle, OpenCode SDK adapter, event mapping, GitHub PR flow |
| `apps/web` | Next.js console: agent chat, sidebar sessions, dashboard |
| `packages/db` | Prisma schema + migrations (`ChatSession`, `Conversation`, `Message`, `AgentRun`, `AgentStep`, `Sandbox`, …) |
| `packages/sandbox` | Docker workspace control (per-user networks/volumes, derived credentials, exec/archive) |
| `packages/run-queue` | Queue name, job type, and `RunEvent` union shared by API + worker |
| `sandbox/` | Dockerfile for the user workspace image (OpenCode, XDG dirs under `/workspace/.kairo`) |

## Environment

Shared keys live in `apps/api/.env` (see `.env.example`); the worker falls
back to that file for `DATABASE_URL`, `REDIS_URL`, `SANDBOX_SECRET`,
`TOKEN_ENCRYPTION_KEY`, and the LLM proxy/model settings. Notable vars:

- `REDIS_URL` — BullMQ queue + SSE pub/sub (default `redis://127.0.0.1:6379`)
- `SANDBOX_SECRET` — HMAC source for per-container OpenCode passwords and LLM proxy tokens
- `NEBIUS_API_KEY` / `NEBIUS_BASE_URL` — OpenAI-compatible upstream behind the proxy
- `OPENCODE_MODEL` / `LLM_MODEL_ALLOWLIST` — default model + what the proxy forwards (default `nvidia/nemotron-3.5-super-vl:free` on OpenRouter)
- `LLM_PROXY_PORT` (4100), `RUN_TIMEOUT_MS` (worker, 10 min)

## Commands

```sh
npm run dev              # turbo: api + web + worker
npm run build            # build all apps/packages
npm run typecheck        # tsc across the monorepo
npm run sandbox:build    # rebuild the workspace image
npm run db:migrate -w @kairo/db
```
