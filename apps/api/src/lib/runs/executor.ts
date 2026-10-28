import { Prisma, prisma } from "@kairo/db";
import {
  createModels,
  loadAgentEnv,
  runAgent,
  type AgentEvent,
  type Workspace,
} from "@kairo/agent";
import type { RunRegistry } from "./registry.js";

const MAX_STEP_PAYLOAD_BYTES = 100_000;

/** Clamps huge tool outputs before they reach the Json column. */
function clampEventForDb(event: AgentEvent): Prisma.InputJsonValue {
  const json = JSON.stringify(event) ?? "null";
  if (json.length <= MAX_STEP_PAYLOAD_BYTES) {
    return event as unknown as Prisma.InputJsonValue;
  }
  return {
    type: event.type,
    clipped: true,
    json: `${json.slice(0, MAX_STEP_PAYLOAD_BYTES)}…[truncated]`,
  };
}

/**
 * Runs one agent task for a user. Fire-and-forget from the HTTP layer:
 * streaming happens through RunRegistry, persistence into AgentStep rows.
 */
export function startRun(
  registry: RunRegistry,
  runId: string,
  userId: string,
  prompt: string,
  workspace: Workspace,
): void {
  void executeRun(registry, runId, userId, prompt, workspace);
}

export async function executeRun(
  registry: RunRegistry,
  runId: string,
  userId: string,
  prompt: string,
  workspace: Workspace,
): Promise<void> {
  let writes: Promise<void> = Promise.resolve();
  const persist = (event: AgentEvent): void => {
    writes = writes.then(async () => {
      const stored = registry.push(runId, event);
      if (!stored) return;
      await prisma.agentStep
        .create({
          data: {
            runId,
            seq: stored.seq,
            type: event.type,
            payload: clampEventForDb(event),
          },
        })
        .catch(() => undefined);
    });
  };
  const terminal = (done: Extract<AgentEvent, { type: "done" }>): void => {
    persist(done);
    writes = writes.then(() => {
      void prisma.agentRun
        .update({
          where: { id: runId },
          data: { status: done.status, finishedAt: new Date() },
        })
        .catch(() => undefined);
    });
  };
  const isTerminal = (): boolean => registry.get(runId)?.closed === true;

  const fail = (code: string, message: string): void => {
    persist({ type: "error", code, message });
    terminal({
      type: "done",
      status: "FAILED",
      summary: message,
      steps: 0,
      durationMs: 0,
      error: { code, message },
    });
  };

  try {
    const agentEnv = loadAgentEnv();
    if (!agentEnv.NEBIUS_API_KEY || agentEnv.NEBIUS_API_KEY.trim() === "") {
      fail(
        "MODEL_NOT_CONFIGURED",
        "NEBIUS_API_KEY is not configured; add it to apps/api/.env and restart the API.",
      );
      return;
    }
    const models = createModels(agentEnv);
    const channel = registry.get(runId);
    if (!channel) return;
    void userId;
    const result = await runAgent({
      workspace,
      executorModel: models.executor,
      plannerModel: models.planner,
      task: prompt,
      env: agentEnv,
      signal: channel.controller.signal,
      onEvent: (event) => {
        if (isTerminal()) return;
        if (event.type === "done") {
          terminal(event);
          return;
        }
        persist(event);
      },
    });
    if (!isTerminal()) {
      // Agent loop returned without emitting a done event — synthesize one.
      terminal({
        type: "done",
        status: result.status,
        summary: result.summary,
        steps: result.steps,
        durationMs: result.durationMs,
        finish: result.finish,
        error: result.error,
      });
    }
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Run cancelled by user"
        : `${error instanceof Error ? error.message : String(error)}`;
    if (!isTerminal()) {
      fail("RUN_CRASHED", message);
    }
  } finally {
    const channel = registry.get(runId);
    if (channel && !channel.closed) {
      registry.close(runId, {
        type: "done",
        status: channel.controller.signal.aborted ? "CANCELLED" : "FAILED",
        summary: "Run ended unexpectedly.",
        steps: 0,
        durationMs: 0,
      });
      void prisma.agentRun
        .update({
          where: { id: runId },
          data: {
            status: channel.controller.signal.aborted ? "CANCELLED" : "FAILED",
            finishedAt: new Date(),
          },
        })
        .catch(() => undefined);
    }
    await writes.catch(() => undefined);
  }
}
