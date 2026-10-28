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
import { env } from "./env.js";
import { ensureWorkspaceConfig } from "./config.js";
import { containerBaseUrl, createClient, waitForHealth } from "./opencode.js";
import { buildPrompt } from "./prompt.js";
import { PartThrottle, StepEmitter, maxSeqFor } from "./publish.js";
import { GithubFlowError, githubFinish, githubPrepare } from "./github.js";

const CANCEL_POLL_MS = 1_500;
const HEALTH_TIMEOUT_MS = 90_000;
const MAX_SUMMARY_CHARS = 100_000;

type Outcome =
  | { kind: "idle" }
  | { kind: "cancelled" }
  | { kind: "timeout" }
  | { kind: "error"; message: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminal(status: string): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";
}

function isInfraError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|ECONNREFUSED|ECONNRESET|socket|not healthy|network|aborted/i.test(message);
}

export async function processRun({ runId, userId }: RunJobData): Promise<void> {
  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (run === null || isTerminal(run.status)) return;

  const redis = createRedis(env.REDIS_URL);
  let emitter: StepEmitter | null = null;

  try {
    if (await redis.get(runCancelKey(runId))) {
      await finalize(runId, "CANCELLED", "Cancelled before the worker started it.");
      return;
    }

    emitter = new StepEmitter(runId, await maxSeqFor(runId), redis);
    const throttle = new PartThrottle((event) => emitter?.emit(event));
    emitter.emit({ type: "workspace", state: "starting" });

    const conversation =
      run.conversationId !== null
        ? await prisma.conversation.findUnique({ where: { id: run.conversationId } })
        : null;

    const ws = new DockerWorkspace(userId);
    let attempt = 0;
    for (;;) {
      try {
        await runOnce(ws, run, conversation, emitter, throttle, redis);
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt === 0 && isInfraError(error)) {
          attempt += 1;
          emitter.emit({ type: "error", code: "INFRA_RETRY", message: `Retrying once after infra error: ${message}` });
          throttle.flushAll();
          await emitter.flush();
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
  const running: RunningSandbox = await ws.ensureRunning();
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
  emitter.emit({ type: "workspace", state: "ready" });

  await ensureWorkspaceConfig(ws);

  const containerName = running.containerName ?? containerNameFor(run.userId);
  const baseUrl = containerBaseUrl(running.hostPort);
  await waitForHealth(baseUrl, containerName, HEALTH_TIMEOUT_MS);
  const client = createClient(baseUrl, containerName);

  // Reuse the conversation's OpenCode session when it still exists on the
  // (volume-persisted) server; otherwise create one and remember it.
  let sessionId = conversation?.opencodeSessionId ?? null;
  if (sessionId !== null) {
    const existing = await client.session.get({ path: { id: sessionId } });
    if (existing.error !== undefined) sessionId = null;
  }
  if (sessionId === null) {
    const created = await client.session.create({
      body: { title: run.prompt.replace(/\s+/g, " ").trim().slice(0, 60) || "Kairo run" },
    });
    if (created.error !== undefined || created.data === undefined) {
      throw new Error(`could not create opencode session: ${JSON.stringify(created.error ?? {})}`);
    }
    sessionId = created.data.id;
    if (conversation !== null) {
      await prisma.conversation
        .update({ where: { id: conversation.id }, data: { opencodeSessionId: sessionId } })
        .catch(() => undefined);
    }
  }

  if (run.repoFullName !== null) {
    await githubPrepare(ws, run.repoFullName, run.userId);
  }

  await prisma.agentRun
    .update({ where: { id: run.id }, data: { status: "RUNNING" } })
    .catch(() => undefined);

  // Subscribe BEFORE prompting so no part update is missed.
  const { stream } = await client.event.subscribe();
  const outcomeBox: { current: Outcome } = { current: { kind: "timeout" } };
  let disposed = false;

  const consume = (async () => {
    for await (const event of stream) {
      if (disposed) return;
      const properties = (event as { properties?: { sessionID?: string } }).properties;
      if (properties?.sessionID !== undefined && properties.sessionID !== sessionId) continue;
      if (event.type === "message.part.updated") {
        const part = (event as { properties: { part: Part } }).properties.part;
        mapPart(part, throttle);
        continue;
      }
      if (event.type === "session.error") {
        const message =
          (event as { properties: { error?: { name?: string; message?: string } } })
            .properties.error?.message ?? "OpenCode session error";
        outcomeBox.current = { kind: "error", message };
        return;
      }
      if (event.type === "session.idle") {
        outcomeBox.current = { kind: "idle" };
        return;
      }
    }
  })().catch(() => undefined);

  let cancelled = false;
  const cancelWait = (async () => {
    while (!disposed) {
      try {
        if (await redis.get(runCancelKey(run.id))) {
          cancelled = true;
          return;
        }
      } catch {
        return;
      }
      await sleep(CANCEL_POLL_MS);
    }
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
  ]);
  disposed = true;
  if (timeoutHandle) clearTimeout(timeoutHandle);

  // `outcome` is written from the consume loop; re-read after the race so
  // TypeScript's flow analysis doesn't assume the initializer is still current.
  const finalOutcome: Outcome =
    raced === "cancel"
      ? { kind: "cancelled" }
      : raced === "timeout"
        ? { kind: "timeout" }
        : outcomeBox.current;

  if (finalOutcome.kind !== "idle") {
    // Best-effort abort so the container's generation stops burning tokens.
    await client.session.abort({ path: { id: sessionId } }).catch(() => undefined);
    await sleep(300);
  }
  await stream.return?.(undefined).catch(() => undefined);
  throttle.flushAll();

  const summary =
    finalOutcome.kind === "idle" || finalOutcome.kind === "timeout"
      ? await lastAssistantText(client, sessionId)
      : null;
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
  if (status === "SUCCEEDED" && run.repoFullName !== null && clippedSummary !== null) {
    try {
      prUrl = await githubFinish(
        ws,
        { id: run.id, userId: run.userId, repoFullName: run.repoFullName, prompt: run.prompt },
        clippedSummary,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitter.emit({
        type: "error",
        code: error instanceof GithubFlowError ? "GITHUB_FLOW" : "GITHUB_FLOW",
        message,
      });
    }
  }

  if (status === "SUCCEEDED" && clippedSummary !== null && run.conversationId !== null) {
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
