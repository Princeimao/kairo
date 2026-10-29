import IORedis from "ioredis";
import type { OpencodeClient, Part } from "@opencode-ai/sdk";
import { prisma } from "@kairo/db";
import {
  DockerWorkspace,
  containerNameFor,
  llmTokenFor,
  llmTokenHash,
  serverPasswordFor,
  type RunningSandbox,
} from "@kairo/sandbox";
import {
  createRedis,
  runCancelKey,
  type RunEvent,
  type RunJobData,
} from "@kairo/run-queue";
import { env, modelSettings } from "./env.js";
import { ensureWorkspaceConfig } from "./config.js";
import { containerBaseUrl, createClient, waitForHealth } from "./opencode.js";
import { buildPrompt } from "./prompt.js";
import { PartThrottle, StepEmitter, maxSeqFor } from "./publish.js";
import { GithubFlowError, githubFinish, githubPrepare } from "./github.js";

const CANCEL_POLL_MS = 1_500;
const HEALTH_TIMEOUT_MS = 90_000;
const MAX_SUMMARY_CHARS = 100_000;
const STALL_WARN_MS = 30_000;
const STALL_FAIL_MS = 120_000;

type Outcome =
  | { kind: "idle" }
  | { kind: "cancelled" }
  | { kind: "timeout" }
  | { kind: "error"; message: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(runId: string, message: string): void {
  console.log(`[worker] run ${runId}: ${message}`);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTerminal(status: string): boolean {
  return (
    status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED"
  );
}

function isInfraError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|ECONNREFUSED|ECONNRESET|socket|not healthy|network|aborted/i.test(
    message,
  );
}

export async function processRun({ runId, userId }: RunJobData): Promise<void> {
  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (run === null) {
    console.log(`[worker] run ${runId} not found — dropping job`);
    return;
  }
  if (isTerminal(run.status)) {
    log(runId, `already ${run.status} — dropping job`);
    return;
  }
  log(
    runId,
    `picked up (status=${run.status}, mode=${run.mode}, repo=${run.repoFullName ?? "none"}, prompt="${run.prompt.slice(0, 80).replace(/\s+/g, " ")}")`,
  );

  const redis = createRedis(env.REDIS_URL);
  let emitter: StepEmitter | null = null;

  try {
    if (await redis.get(runCancelKey(runId))) {
      log(runId, "cancel flag already set — cancelling before start");
      await finalize(
        runId,
        "CANCELLED",
        "Cancelled before the worker started it.",
      );
      return;
    }

    emitter = new StepEmitter(runId, await maxSeqFor(runId), redis);
    const throttle = new PartThrottle((event) => emitter?.emit(event));
    emitter.emit({ type: "workspace", state: "starting" });

    const conversation =
      run.conversationId !== null
        ? await prisma.conversation.findUnique({
            where: { id: run.conversationId },
          })
        : null;
    log(
      runId,
      `conversation=${run.conversationId ?? "none"} opencodeSession=${conversation?.opencodeSessionId ?? "none"}`,
    );

    const ws = new DockerWorkspace(userId);
    let attempt = 0;
    for (;;) {
      try {
        await runOnce(ws, run, conversation, emitter, throttle, redis);
        log(runId, "finished without throwing");
        break;
      } catch (error) {
        const message = errorText(error);
        if (attempt === 0 && isInfraError(error)) {
          attempt += 1;
          log(runId, `infra error, retrying once: ${message}`);
          emitter.emit({
            type: "error",
            code: "INFRA_RETRY",
            message: `Retrying once after infra error: ${message}`,
          });
          throttle.flushAll();
          await emitter.flush();
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    const message = errorText(error);
    console.error(`[worker] run ${runId} failed: ${message}`);
    emitter?.emit({ type: "error", code: "RUN_FAILED", message });
    await finalize(runId, "FAILED", message);
  } finally {
    await emitter?.flush().catch(() => undefined);
    redis.disconnect();
  }
}

async function runOnce(
  ws: DockerWorkspace,
  run: {
    id: string;
    userId: string;
    prompt: string;
    mode: string;
    repoFullName: string | null;
    conversationId: string | null;
    status: string;
  },
  conversation: { id: string; opencodeSessionId: string | null } | null,
  emitter: StepEmitter,
  throttle: PartThrottle,
  redis: IORedis,
): Promise<void> {
  const settings = modelSettings();
  let running: RunningSandbox = await ws.ensureRunning();
  log(
    run.id,
    `workspace running: container=${running.containerName} image=${running.image} hostPort=${running.hostPort}`,
  );
  await prisma.sandbox
    .upsert({
      where: { userId: run.userId },
      create: {
        userId: run.userId,
        image: running.image,
        volumeName: running.volumeName,
        containerName: running.containerName,
        llmTokenHash: llmTokenHash(llmTokenFor(running.containerName)),
      },
      update: {
        lastActiveAt: new Date(),
        image: running.image,
        containerName: running.containerName,
        llmTokenHash: llmTokenHash(llmTokenFor(running.containerName)),
      },
    })
    .catch(() => undefined);
  const { changed: configChanged } = await ensureWorkspaceConfig(ws, settings);
  log(
    run.id,
    `workspace config ensured (provider=${settings.providerId} model=${settings.modelId})`,
  );
  if (configChanged) {
    log(
      run.id,
      "opencode.json changed — restarting the container so the server loads it",
    );
    await ws.stop();
    running = await ws.ensureRunning();
    log(
      run.id,
      `container restarted: container=${running.containerName} hostPort=${running.hostPort}`,
    );
  }
  emitter.emit({ type: "workspace", state: "ready" });

  const containerName = running.containerName ?? containerNameFor(run.userId);
  const baseUrl = containerBaseUrl(running.hostPort);
  log(
    run.id,
    `waiting for opencode health at ${baseUrl} (timeout ${HEALTH_TIMEOUT_MS}ms)`,
  );

  const healthStarted = Date.now();
  await waitForHealth(baseUrl, containerName, HEALTH_TIMEOUT_MS);
  log(run.id, `opencode healthy after ${Date.now() - healthStarted}ms`);
  const client = createClient(baseUrl, containerName);

  let sessionId = conversation?.opencodeSessionId ?? null;
  if (sessionId !== null) {
    const existing = await client.session.get({ path: { id: sessionId } });
    if (existing.error !== undefined) {
      log(
        run.id,
        `stored opencode session ${sessionId} gone (${JSON.stringify(existing.error)}) — creating a new one`,
      );
      sessionId = null;
    } else {
      log(run.id, `reusing opencode session ${sessionId}`);
    }
  }
  if (sessionId === null) {
    const created = await client.session.create({
      body: {
        title:
          run.prompt.replace(/\s+/g, " ").trim().slice(0, 60) || "Kairo run",
      },
    });
    if (created.error !== undefined || created.data === undefined) {
      throw new Error(
        `could not create opencode session: ${JSON.stringify(created.error ?? {})}`,
      );
    }
    sessionId = created.data.id;
    log(run.id, `created opencode session ${sessionId}`);
    if (conversation !== null) {
      await prisma.conversation
        .update({
          where: { id: conversation.id },
          data: { opencodeSessionId: sessionId },
        })
        .catch(() => undefined);
    }
  }

  if (run.repoFullName !== null) {
    log(run.id, `preparing github repo ${run.repoFullName}`);
    await githubPrepare(ws, run.repoFullName, run.userId);
    log(run.id, "github repo ready");
  }

  await prisma.agentRun
    .update({ where: { id: run.id }, data: { status: "RUNNING" } })
    .catch(() => undefined);

  // Subscribe BEFORE prompting so no part update is missed.
  log(run.id, "subscribing to opencode event stream");
  const { stream } = await client.event.subscribe();
  const outcomeBox: { current: Outcome } = { current: { kind: "timeout" } };
  let disposed = false;
  let sawAnyEvent = false;
  let matchedEvents = 0;
  let droppedOtherSession = 0;

  const consume = (async () => {
    for await (const event of stream) {
      if (disposed) return;
      if (!sawAnyEvent) {
        sawAnyEvent = true;
        log(run.id, `first event received: ${event.type}`);
      }
      const properties = (event as { properties?: { sessionID?: string } })
        .properties;
      if (
        properties?.sessionID !== undefined &&
        properties.sessionID !== sessionId
      ) {
        droppedOtherSession += 1;
        continue;
      }
      matchedEvents += 1;
      if (event.type === "message.part.updated") {
        const part = (event as { properties: { part: Part } }).properties.part;
        if (matchedEvents <= 5 || part.type === "tool") {
          log(run.id, `part: type=${part.type} id=${part.id}`);
        }
        mapPart(part, throttle);
        continue;
      }
      if (event.type === "session.error") {
        const props = (
          event as {
            properties?: {
              sessionID?: string;
              error?: unknown;
            };
          }
        ).properties;

        const rawError = props?.error;

        // Preserve the full structured error, including nested data.
        const details =
          rawError instanceof Error
            ? {
                name: rawError.name,
                message: rawError.message,
                stack: rawError.stack,
              }
            : rawError;

        log(
          run.id,
          `session.error payload: ${JSON.stringify({
            sessionID: props?.sessionID,
            error: details,
          })}`,
        );

        const message =
          rawError !== undefined
            ? JSON.stringify(details)
            : "OpenCode emitted session.error without an error payload";

        outcomeBox.current = { kind: "error", message };
        return;
      }

      if (event.type === "session.idle") {
        log(run.id, "session.idle event — turn complete");
        outcomeBox.current = { kind: "idle" };
        return;
      }
      log(run.id, `event: ${event.type}`);
    }
    log(
      run.id,
      `event stream ENDED without idle/error (sawAny=${sawAnyEvent}, matched=${matchedEvents}, otherSession=${droppedOtherSession})`,
    );
  })().catch((error) => {
    log(run.id, `event stream crashed: ${errorText(error)}`);
  });

  let cancelled = false;
  const cancelWait = (async () => {
    while (!disposed) {
      try {
        if (await redis.get(runCancelKey(run.id))) {
          cancelled = true;
          log(run.id, "cancel flag detected — aborting wait");
          return;
        }
      } catch {
        return;
      }
      await sleep(CANCEL_POLL_MS);
    }
  })();

  // THE actual prompt. Without this the run waits forever for session.idle.
  const promptText = buildPrompt(run);
  log(
    run.id,
    `prompting session ${sessionId} (model=${settings.providerId}/${settings.modelId}, chars=${promptText.length})`,
  );
  const promptStarted = Date.now();
  const promptResult = await client.session.promptAsync({
    path: { id: sessionId },
    body: {
      parts: [{ type: "text", text: promptText }],
      model: {
        providerID: settings.providerId,
        modelID: settings.modelId,
      },
    },
  });
  if (promptResult.error !== undefined) {
    throw new Error(
      `opencode rejected the prompt (HTTP ${JSON.stringify(promptResult.error)}) — check model/provider config in the container`,
    );
  }
  log(
    run.id,
    `prompt accepted in ${Date.now() - promptStarted}ms — streaming events`,
  );

  // Stall watchdog: warn when nothing arrives, fail when the stream is dead.
  const stall = (async (): Promise<"stall"> => {
    await sleep(STALL_WARN_MS);
    if (!disposed && !sawAnyEvent) {
      log(
        run.id,
        `WARNING: no opencode events after ${STALL_WARN_MS}ms (baseUrl=${baseUrl}) — LLM proxy or model config is likely broken`,
      );
    }
    await sleep(STALL_FAIL_MS - STALL_WARN_MS);
    if (!disposed && !sawAnyEvent) {
      log(run.id, `giving up: zero events after ${STALL_FAIL_MS}ms`);
      return "stall";
    }
    while (!disposed) await sleep(1_000);
    return "stall";
  })();

  let timeoutHandle: NodeJS.Timeout | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timeoutHandle = setTimeout(() => resolve("timeout"), env.RUN_TIMEOUT_MS);
    timeoutHandle.unref?.();
  });

  const raced = await Promise.race([
    consume.then(() => "consume" as const),
    cancelWait.then(() => "cancel" as const),
    timedOut,
    stall,
  ]);
  disposed = true;
  if (timeoutHandle) clearTimeout(timeoutHandle);
  log(
    run.id,
    `wait over: raced=${raced} sawAny=${sawAnyEvent} matched=${matchedEvents} otherSession=${droppedOtherSession}`,
  );

  // `outcome` is written from the consume loop; re-read after the race so
  // TypeScript's flow analysis doesn't assume the initializer is still current.
  const finalOutcome: Outcome =
    raced === "cancel"
      ? { kind: "cancelled" }
      : raced === "timeout"
        ? { kind: "timeout" }
        : raced === "stall"
          ? {
              kind: "error",
              message: `No events received from OpenCode after ${STALL_FAIL_MS / 1000}s — check the LLM proxy URL/allowlist and the container's opencode.json`,
            }
          : outcomeBox.current;
  log(run.id, `outcome: ${finalOutcome.kind}`);

  if (finalOutcome.kind !== "idle") {
    // Best-effort abort so the container's generation stops burning tokens.
    const abortResult = await client.session
      .abort({ path: { id: sessionId } })
      .then(() => "ok" as const)
      .catch((error: unknown) => `failed: ${errorText(error)}`);
    log(run.id, `session.abort: ${abortResult}`);
    await sleep(300);
  }
  await stream.return?.(undefined).catch(() => undefined);
  throttle.flushAll();

  const summary =
    finalOutcome.kind === "cancelled"
      ? null
      : await lastAssistantText(client, sessionId);
  log(
    run.id,
    `assistant summary: ${summary === null ? "none" : `${summary.length} chars`}`,
  );
  const clippedSummary =
    summary !== null ? summary.slice(0, MAX_SUMMARY_CHARS) : null;

  let status: "SUCCEEDED" | "FAILED" | "CANCELLED";
  let errorMessage: string | null = null;
  if (finalOutcome.kind === "idle") {
    status = "SUCCEEDED";
  } else if (finalOutcome.kind === "cancelled") {
    status = "CANCELLED";
    errorMessage = "Cancelled by user";
  } else if (finalOutcome.kind === "timeout") {
    status = "FAILED";
    errorMessage = `Run exceeded the ${Math.round(env.RUN_TIMEOUT_MS / 60_000)} minute limit`;
  } else {
    status = "FAILED";
    errorMessage = finalOutcome.message;
  }

  let prUrl: string | null = null;
  if (
    status === "SUCCEEDED" &&
    run.repoFullName !== null &&
    clippedSummary !== null
  ) {
    try {
      log(run.id, "opening pull request via github flow");
      prUrl = await githubFinish(
        ws,
        {
          id: run.id,
          userId: run.userId,
          repoFullName: run.repoFullName,
          prompt: run.prompt,
        },
        clippedSummary,
      );
      log(run.id, `pull request: ${prUrl}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(run.id, `github flow failed: ${message}`);
      emitter.emit({
        type: "error",
        code: error instanceof GithubFlowError ? "GITHUB_FLOW" : "GITHUB_FLOW",
        message,
      });
    }
  }

  if (
    status === "SUCCEEDED" &&
    clippedSummary !== null &&
    run.conversationId !== null
  ) {
    await prisma.message
      .create({
        data: {
          conversationId: run.conversationId,
          role: "AGENT",
          content: clippedSummary,
          runId: run.id,
        },
      })
      .catch(() => undefined);
  }

  emitter.emit({
    type: "done",
    status,
    summary: clippedSummary ?? errorMessage ?? "Run finished.",
    prUrl: prUrl ?? undefined,
  });

  await prisma.agentRun
    .update({
      where: { id: run.id },
      data: {
        status,
        finishedAt: new Date(),
        errorMessage,
        prUrl: prUrl ?? undefined,
      },
    })
    .catch(() => undefined);
  log(
    run.id,
    `run finalized: ${status}${errorMessage ? ` (${errorMessage})` : ""}`,
  );
}

function mapPart(part: Part, throttle: PartThrottle): void {
  if (part.type === "text") {
    throttle.push(
      `text:${part.id}`,
      { type: "text", text: part.text, done: part.time?.end != null },
      part.time?.end != null,
    );
    return;
  }
  if (part.type === "reasoning") {
    throttle.push(
      `reasoning:${part.id}`,
      { type: "reasoning", text: part.text, done: part.time?.end != null },
      part.time?.end != null,
    );
    return;
  }
  if (part.type === "tool") {
    const state = part.state;
    const mapped: RunEvent =
      state.status === "completed"
        ? {
            type: "tool",
            name: part.tool,
            callId: part.callID,
            state: "done",
            input: state.input,
            output: state.output,
          }
        : state.status === "error"
          ? {
              type: "tool",
              name: part.tool,
              callId: part.callID,
              state: "error",
              input: state.input,
              output: state.error,
            }
          : {
              type: "tool",
              name: part.tool,
              callId: part.callID,
              state: "running",
              input: state.input,
            };
    throttle.push(`tool:${part.id}`, mapped, state.status !== "running");
  }
}

async function lastAssistantText(
  client: OpencodeClient,
  sessionId: string,
): Promise<string | null> {
  try {
    const result = await client.session.messages({ path: { id: sessionId } });
    if (result.error !== undefined || result.data === undefined) return null;
    const messages = result.data as Array<{
      info: { role: string; sessionID: string; summary?: boolean };
      parts: Part[];
    }>;
    const assistants = messages.filter(
      (message) =>
        message.info.role === "assistant" &&
        message.info.sessionID === sessionId &&
        message.info.summary !== true,
    );
    const last = assistants[assistants.length - 1];
    if (last === undefined) return null;
    const text = last.parts
      .filter((part) => part.type === "text")
      .map((part) => (part as { text: string }).text)
      .join("\n")
      .trim();
    return text === "" ? null : text;
  } catch {
    return null;
  }
}

async function finalize(
  runId: string,
  status: "CANCELLED" | "FAILED",
  errorMessage: string,
): Promise<void> {
  await prisma.agentRun
    .updateMany({
      where: { id: runId, status: { in: ["QUEUED", "RUNNING"] } },
      data: { status, finishedAt: new Date(), errorMessage },
    })
    .catch(() => undefined);
}
