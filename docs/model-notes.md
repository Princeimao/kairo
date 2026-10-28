# Model notes (OpenCode harness)

Model calls no longer go through a hand-rolled loop. OpenCode inside each user
sandbox talks to a **token-gated LLM proxy** in the API process
(`apps/api/src/llm/proxy.ts`, mounted at `/internal/llm`), which forwards to an
OpenAI-compatible upstream.

## Provider

- Upstream: `NEBIUS_BASE_URL` + `NEBIUS_API_KEY` (any OpenAI-compatible endpoint).
- Current local default (apps/api/.env): OpenRouter —
  `https://openrouter.ai/api/v1`, model `nvidia/nemotron-3.5-super-vl:free`.
- The proxy injects the upstream key; containers only ever hold their own
  per-container Kairo token (HMAC-derived, hash-only in the DB).

## Model selection

- `OPENCODE_MODEL` — default model written into each container's
  `opencode.json` (`<providerID>/<modelID>`, provider id `kairo`).
- `LLM_MODEL_ALLOWLIST` — comma-separated ids the proxy will forward
  (default `nvidia/nemotron-3.5-super-vl:free`). Requests for other models are
  rejected at the proxy.
- `OPENCODE_PROVIDER_ID` (worker) — provider key in opencode.json; default `kairo`.

The proxy also enforces `max_tokens` (cap 8192) and injects
`stream_options.include_usage` so token counts land on `AgentRun.tokensIn/Out`.

## Historical probes (deleted)

The old `npm run model:check` / `offline:check` probes lived in
`packages/agent` (AI SDK loop, planner/executor split, JSON tool mode) and were
removed with that package in R2. The planner/executor model split no longer
exists — one model per conversation, chosen via `OPENCODE_MODEL`.

If a new upstream/model needs vetting, probe it against the container path:
start a run with `OPENCODE_MODEL` pointed at the candidate, keep
`LLM_MODEL_ALLOWLIST` in sync, and check `session.idle` completion + tool-call
quality from the SSE stream (`GET /runs/:id/events`).

## Candidate models (kept for reference)

| model id | context | notes |
| --- | --- | --- |
| `nvidia/nemotron-3.5-super-vl:free` | 1024K | current default (vision-language; text tools only used) |
| `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | 262K | smallest/cheapest Nemotron |
| `nvidia/nemotron-3-super-120b-a12b` | 256K | vendor docs: function calling + structured output out of the box |
| `nvidia/Nemotron-3_5-Lightning` | 1024K | newer 3.5 line, cheap |
| `nvidia/Nemotron-3-Ultra-550b-a55b` | 1024K | flagship; heavy/expensive — likely overkill |
