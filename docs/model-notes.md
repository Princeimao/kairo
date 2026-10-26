# Model notes (Stage 5 — agent core)

Provider: [Nebius Token Factory](https://tokenfactory.nebius.com) — OpenAI-compatible API.

- Endpoint used by the agent: `NEBIUS_BASE_URL` (default `https://api.tokenfactory.nebius.com/v1`).
- Auth: `Authorization: Bearer NEBIUS_API_KEY`.

## Status: PENDING LIVE PROBE

`NEBIUS_API_KEY` was not available when this stage was built, so the reliability
probes below describe **what will be tested and how**, not yet observed results.

After adding the key (packages/agent/.env, repo root .env, or shell env), run:

```
npm run model:check -w packages/agent
```

It probes every model in `AGENT_PROBE_MODELS` (comma separated) with three tests
and prints a markdown table ready to paste into this file:

1. **single tool call** — one tool with no required args, `toolChoice: "required"`;
   passes when the model makes exactly one correct call.
2. **multi-step tool use** — `add(a, b)` then `finish(summary)` across steps;
   passes when both calls happen and the summary contains the correct result (42).
3. **structured output** — strict JSON object via `Output.object` with a zod schema;
   passes when the exact object comes back.

Observations to record per model: verdict per test, latency (ms), error messages,
and any prompt-shape adjustments that made it work.

## Candidate Nemotron models (from the Token Factory catalog)

| model id | context | notes |
| --- | --- | --- |
| `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | 262K | smallest/cheapest Nemotron; candidate planner |
| `nvidia/nemotron-3-super-120b-a12b` | 256K | "supports function calling and structured output out of the box" per vendor docs; candidate executor |
| `nvidia/Nemotron-3_5-Lightning` | 1024K | newer 3.5 line, cheap; probe both roles |
| `nvidia/Nemotron-3-Ultra-550b-a55b` | 1024K | flagship; heavy/expensive — probe for tool calling, likely overkill for executor |
| `nvidia/Nemotron-3.5-Super-VL` | 1024K | vision-language — out of scope (text tools only) |

## Current defaults (until live results)

- `AGENT_PLANNER_MODEL=nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` — planning is short
  structured output; use the small model for cost/latency.
- `AGENT_EXECUTOR_MODEL=nvidia/nemotron-3-super-120b-a12b` — tool calling and
  structured output are documented as first-class for this model.

## Fallback design (independent of probe results)

- The product calls tool executors through one shared executor layer
  (`packages/agent/src/tools/executors.ts`). Both integration paths call it:
  - **native** (default): AI SDK `streamText` tool loop.
  - **json** (`AGENT_TOOL_MODE=json`): model emits one strict JSON action per
    turn, validated with a zod discriminated union (`tools/actions.ts`), then the
    same executors run it. This must work even when native tool calling is
    unreliable.
- `npm run offline:check -w packages/agent` runs the full workspace safety suite
  and both loop modes against mock models with no network access (25 checks).
- Decision rule once probing is done: if a model fails single/multi/structured
  probes consistently (>1 failure per 5 runs), switch it to `json` mode or drop
  it from the candidate list. Executor should be the model with the best
  multi-step score; planner only needs structured output.
