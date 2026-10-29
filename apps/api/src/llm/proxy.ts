import http from "node:http";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import express, { type Request, type Response } from "express";
import { prisma } from "@kairo/db";
import { DockerWorkspace } from "@kairo/sandbox";
import { env, freshEnvValue } from "../config/env.js";

/**
 * Host-side LLM proxy (R4). Containers never see the upstream API key: OpenCode
 * points its openai-compatible provider at /internal/llm/v1 with a
 * per-container token (KAIRO_LLM_TOKEN). Every request must prove:
 *
 *   1. bearer token hashes to a Sandbox.llmTokenHash row,
 *   2. that user's container is currently running,
 *   3. that user has an active (QUEUED/RUNNING) run,
 *   4. the model is on the allowlist.
 *
 * Then the request is forwarded to NEBIUS_BASE_URL with the real key and the
 * response is streamed back verbatim (SSE passthrough) while usage chunks are
 * parsed for token accounting on the run row. No prompt/secret content is
 * logged — metadata only.
 */

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 10 * 60 * 1000;
const ACTIVE_RUN_GRACE_MS = 15 * 60 * 1000;
const MAX_OUTPUT_TOKENS = 8_192;
const ROOT = "/internal/llm";

/**
 * Allowed model ids, re-read from apps/api/.env on every request so edits
 * apply without an API restart. Always includes the current OPENCODE_MODEL
 * (provider prefix stripped) in addition to LLM_MODEL_ALLOWLIST.
 */
function modelAllowlist(): Set<string> {
  const allow = new Set<string>();
  const list = freshEnvValue("LLM_MODEL_ALLOWLIST") ?? env.LLM_MODEL_ALLOWLIST;
  for (const entry of list.split(",")) {
    const trimmed = entry.trim();
    if (trimmed.length > 0) allow.add(trimmed);
  }
  const model = (freshEnvValue("OPENCODE_MODEL") ?? env.OPENCODE_MODEL).trim();
  if (model.length > 0) {
    const provider = freshEnvValue("OPENCODE_PROVIDER_ID");
    const prefix = `${(provider ?? "").trim()}/`;
    allow.add(provider !== null && model.startsWith(prefix) ? model.slice(prefix.length) : model);
    allow.add(model);
  }
  return allow;
}

interface Authed {
  userId: string;
  runId: string;
}

function deny(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { message, type: code } });
}

async function authenticate(req: Request): Promise<Authed | null> {
  const header = req.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  if (token === "") return null;
  const hash = createHash("sha256").update(token).digest("hex");
  const sandbox = await prisma.sandbox.findUnique({ where: { llmTokenHash: hash } });
  if (sandbox === null) return null;
  const running = await new DockerWorkspace(sandbox.userId).status();
  if (!running.running) return null;
  const run = await prisma.agentRun.findFirst({
    where: {
      userId: sandbox.userId,
      status: { in: ["QUEUED", "RUNNING"] },
      createdAt: { gte: new Date(Date.now() - ACTIVE_RUN_GRACE_MS) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (run === null) return null;
  return { userId: sandbox.userId, runId: run.id };
}

/** "/internal/llm/v1/chat/completions" → "<NEBIUS_BASE_URL>/chat/completions" */
function upstreamUrl(suffixAfterRoot: string): string {
  const withoutRoot = suffixAfterRoot.startsWith(ROOT)
    ? suffixAfterRoot.slice(ROOT.length)
    : suffixAfterRoot;
  const withoutVersion = withoutRoot.startsWith("/v1")
    ? withoutRoot.slice(3)
    : withoutRoot;
  return `${env.NEBIUS_BASE_URL.replace(/\/+$/, "")}${withoutVersion}`;
}

function collectRawBody(
  req: Request,
  res: Response,
  next: (error?: unknown) => void,
): void {
  const chunks: Buffer[] = [];
  let size = 0;
  req.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      deny(res, 413, "payload_too_large", "request body too large");
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    (req as Request & { rawBody?: Buffer }).rawBody = Buffer.concat(chunks);
    next();
  });
  req.on("error", (error) => next(error));
}

function readRawBody(req: Request): Buffer {
  return (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
}

/** Incremental SSE scanner that captures `usage` objects, then forwards. */
function teeWithUsage(
  upstream: Readable,
  onUsage: (usage: { prompt_tokens?: number; completion_tokens?: number }) => void,
): Readable {
  let pending = "";
  return upstream.map((chunk: Buffer) => {
    pending += chunk.toString("utf8");
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "" || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload) as {
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        if (parsed.usage) onUsage(parsed.usage);
      } catch {
        // partial/unrelated line — not every data line is JSON
      }
    }
    return chunk;
  });
}

async function applyUsage(
  runId: string,
  usage: { prompt_tokens?: number; completion_tokens?: number },
): Promise<void> {
  const tokensIn = usage.prompt_tokens ?? 0;
  const tokensOut = usage.completion_tokens ?? 0;
  if (tokensIn <= 0 && tokensOut <= 0) return;
  await prisma.agentRun
    .update({
      where: { id: runId },
      data: { tokensIn: { increment: tokensIn }, tokensOut: { increment: tokensOut } },
    })
    .catch(() => undefined);
}

function handleModels(req: Request, res: Response): void {
  void req;
  res.json({
    object: "list",
    data: [...modelAllowlist()].map((id) => ({
      id,
      object: "model",
      created: 0,
      owned_by: "kairo-proxy",
    })),
  });
}

async function handleChat(req: Request, res: Response): Promise<void> {
  const startedAt = Date.now();
  const authed = await authenticate(req);
  if (authed === null) {
    deny(res, 401, "invalid_token", "sandbox token, container, or active run not valid");
    return;
  }
  if (env.NEBIUS_API_KEY === undefined || env.NEBIUS_API_KEY === "") {
    deny(res, 503, "model_not_configured", "NEBIUS_API_KEY is not configured on the API host");
    return;
  }

  const raw = readRawBody(req);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  } catch {
    deny(res, 400, "invalid_json", "request body is not JSON");
    return;
  }

  const model = typeof body.model === "string" ? body.model : "";
  if (!modelAllowlist().has(model)) {
    deny(res, 403, "model_not_allowed", `model "${model}" is not on the allowlist`);
    return;
  }

  // Cap output size and guarantee a usage chunk on streamed responses.
  if (typeof body.max_tokens === "number" && body.max_tokens > MAX_OUTPUT_TOKENS) {
    body.max_tokens = MAX_OUTPUT_TOKENS;
  }
  const streaming = body.stream === true;
  if (streaming) {
    body.stream_options = { ...(body.stream_options as object | undefined), include_usage: true };
  }
  const payload = Buffer.from(JSON.stringify(body), "utf8");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  res.on("close", () => controller.abort());

  try {
    const upstream = await fetch(upstreamUrl(req.path), {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.NEBIUS_API_KEY}`,
        "content-type": "application/json",
        ...(streaming ? { accept: "text/event-stream" } : {}),
      },
      body: payload,
      signal: controller.signal,
    });

    res.status(upstream.status);
    const contentType = upstream.headers.get("content-type");
    if (contentType) res.setHeader("content-type", contentType);

    if (upstream.body === null) {
      res.end();
      return;
    }

    const web = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
    let stream: Readable;
    if (streaming || (contentType ?? "").includes("text/event-stream")) {
      stream = teeWithUsage(web, (usage) => {
        void applyUsage(authed.runId, usage);
      });
    } else {
      // Non-streaming: buffer small JSON replies to read usage, stream the rest.
      const chunks: Buffer[] = [];
      let size = 0;
      stream = web.map((chunk: Buffer) => {
        chunks.push(chunk);
        size += chunk.length;
        return chunk;
      });
      stream.on("end", () => {
        if (size > 8 * 1024 * 1024) return;
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          if (parsed.usage) void applyUsage(authed.runId, parsed.usage);
        } catch {
          /* not JSON — nothing to account */
        }
      });
    }

    stream.on("error", () => controller.abort());
    stream.pipe(res);
    console.log(
      `[llm] model=${model} user=${authed.userId} run=${authed.runId} status=${upstream.status} ms=${Date.now() - startedAt}`,
    );
  } catch (error) {
    if (!res.headersSent) {
      const message =
        controller.signal.aborted
          ? "upstream timed out or client disconnected"
          : `${error instanceof Error ? error.message : String(error)}`;
      deny(res, 502, "upstream_error", message);
      return;
    }
    res.destroy();
  } finally {
    clearTimeout(timeout);
  }
}

/** Boots the proxy on LLM_PROXY_PORT; returns the server for shutdown. */
export function startLlmProxy(): http.Server {
  const proxy = express();
  proxy.disable("x-powered-by");
  proxy.use(ROOT, collectRawBody);
  proxy.post(`${ROOT}/v1/chat/completions`, (req, res) => {
    void handleChat(req, res);
  });
  proxy.get(`${ROOT}/v1/models`, handleModels);
  proxy.use(ROOT, (req, res) => {
    deny(res, 404, "not_found", `unsupported proxy path: ${req.path}`);
  });
  return proxy.listen(env.LLM_PROXY_PORT, env.LLM_PROXY_HOST, () => {
    console.log(
      `[llm] proxy listening on ${env.LLM_PROXY_HOST}:${env.LLM_PROXY_PORT} → ${env.NEBIUS_BASE_URL}`,
    );
  });
}
