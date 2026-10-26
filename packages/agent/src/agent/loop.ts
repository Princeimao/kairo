import { z } from "zod";
import {
  Output,
  generateText,
  hasToolCall,
  isStepCount,
  streamText,
  type LanguageModel,
  type ModelMessage,
} from "ai";
import { loadAgentEnv, type AgentEnv } from "../config/env.js";
import {
  EXECUTOR_INSTRUCTIONS,
  JSON_ACTION_INSTRUCTIONS,
  PLANNER_INSTRUCTIONS,
  buildExecutorUserMessage,
  buildPlannerPrompt,
  invalidActionRetryMessage,
} from "../prompts.js";
import { createAgentTools } from "../tools/index.js";
import { executeAction, parseAction } from "../tools/actions.js";
import { finishInput, type FinishInput } from "../tools/schemas.js";
import type { Workspace } from "../workspace/types.js";
import type { AgentEventListener, AgentEvent, Plan } from "./events.js";

const planSchema = z.object({
  approach: z.string().min(1),
  steps: z.array(z.object({ id: z.string(), goal: z.string().min(1) })).min(1),
});

export interface RunAgentOptions {
  workspace: Workspace;
  executorModel: LanguageModel;
  plannerModel?: LanguageModel;
  task: string;
  toolMode?: "native" | "json";
  env?: AgentEnv;
  maxSteps?: number;
  maxReplans?: number;
  timeBudgetMs?: number;
  toolTimeoutMs?: number;
  maxToolOutputBytes?: number;
  historyTokenBudget?: number;
  maxStuckRepeats?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  onEvent?: AgentEventListener;
}

export interface AgentResult {
  status: "SUCCEEDED" | "FAILED" | "CANCELLED";
  summary: string;
  steps: number;
  durationMs: number;
  finish?: FinishInput;
  error?: { code: string; message: string };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function estimateTokens(message: ModelMessage): number {
  let text: string;
  if (typeof message.content === "string") {
    text = message.content;
  } else {
    text = JSON.stringify(message.content);
  }
  return Math.ceil(text.length / 4) + 4;
}

function trimToTokenBudget(messages: ModelMessage[], budget: number): ModelMessage[] {
  let total = messages.reduce((sum, m) => sum + estimateTokens(m), 0);
  if (total <= budget) return messages;
  const out = [...messages];
  let index = 0;
  while (total > budget && index < out.length - 2) {
    const original = out[index]!;
    total -= estimateTokens(original);
    out[index] = { ...original, content: "[trimmed to fit the context budget]" } as ModelMessage;
    index += 1;
  }
  return out;
}

function toolOutputOk(output: unknown, isError: boolean | undefined): boolean {
  if (isError) return false;
  if (output && typeof output === "object" && "ok" in output) {
    return (output as { ok: unknown }).ok === true;
  }
  return true;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")) ||
    (typeof error === "object" && error !== null && "name" in error && (error as { name: string }).name === "AbortError")
  );
}

interface ExecutorRunOutcome {
  finish?: FinishInput;
  stuckReason?: string;
  stepLimitReached: boolean;
  abortedBySignal: boolean;
  streamError?: string;
  steps: number;
}

class StuckTracker {
  private readonly seen = new Map<string, number>();
  private consecutiveErrors = 0;
  constructor(private readonly maxRepeats: number) {}

  observe(name: string, args: unknown): void {
    const signature = `${name}:${stableStringify(args)}`;
    const count = (this.seen.get(signature) ?? 0) + 1;
    this.seen.set(signature, count);
  }

  identicalRepeat(name: string, args: unknown): number {
    return this.seen.get(`${name}:${stableStringify(args)}`) ?? 0;
  }

  recordResult(ok: boolean): void {
    this.consecutiveErrors = ok ? 0 : this.consecutiveErrors + 1;
  }

  get consecutiveFailures(): number {
    return this.consecutiveErrors;
  }

  get repeatsAllowed(): number {
    return this.maxRepeats;
  }
}

export async function runAgent(opts: RunAgentOptions): Promise<AgentResult> {
  const env = opts.env ?? loadAgentEnv();
  const maxSteps = opts.maxSteps ?? env.AGENT_MAX_STEPS;
  const maxReplans = opts.maxReplans ?? env.AGENT_MAX_REPLANS;
  const timeBudgetMs = opts.timeBudgetMs ?? env.AGENT_TIME_BUDGET_MS;
  const toolTimeoutMs = opts.toolTimeoutMs ?? env.AGENT_TOOL_TIMEOUT_MS;
  const maxToolOutputBytes = opts.maxToolOutputBytes ?? env.AGENT_MAX_TOOL_OUTPUT_BYTES;
  const historyTokenBudget = opts.historyTokenBudget ?? env.AGENT_HISTORY_TOKEN_BUDGET;
  const maxStuckRepeats = opts.maxStuckRepeats ?? env.AGENT_MAX_STUCK_REPEATS;
  const maxRetries = opts.maxRetries ?? env.AGENT_LLM_MAX_RETRIES;
  const toolMode = opts.toolMode ?? env.AGENT_TOOL_MODE;
  const plannerModel = opts.plannerModel ?? opts.executorModel;
  const emit = (event: AgentEvent): void => opts.onEvent?.(event);

  const startedAt = Date.now();
  const userSignal = opts.signal ?? new AbortController().signal;
  const deadlineSignal = AbortSignal.timeout(timeBudgetMs);
  const baseSignal = AbortSignal.any([userSignal, deadlineSignal]);

  let totalSteps = 0;

  const makePlan = async (priorFailures: string[]): Promise<Plan> => {
    const prompt = buildPlannerPrompt(opts.task, priorFailures);
    try {
      const result = await generateText({
        model: plannerModel,
        instructions: PLANNER_INSTRUCTIONS,
        prompt,
        output: Output.object({ schema: planSchema }),
        maxRetries,
        abortSignal: baseSignal,
      });
      return result.output;
    } catch (error) {
      if (isAbortError(error) || baseSignal.aborted) throw error;
      const fallback = await generateText({
        model: plannerModel,
        instructions: `${PLANNER_INSTRUCTIONS}\nIf structured output failed, still output the JSON object only.`,
        prompt,
        maxRetries,
        abortSignal: baseSignal,
      });
      const match = /{[\s\S]*}/.exec(fallback.text);
      if (!match) throw new Error(`planner did not return a plan: ${errorMessage(error)}`);
      return planSchema.parse(JSON.parse(match[0]));
    }
  };

  const finishDone = (
    status: AgentResult["status"],
    summary: string,
    finish?: FinishInput,
    error?: { code: string; message: string },
  ): AgentResult => {
    const result: AgentResult = {
      status,
      summary,
      steps: totalSteps,
      durationMs: Date.now() - startedAt,
      finish,
      error,
    };
    emit({ type: "done", ...result });
    return result;
  };

  let plan: Plan;
  try {
    plan = await makePlan([]);
    emit({ type: "plan", plan });
  } catch (error) {
    if (deadlineSignal.aborted) {
      const message = `Time budget of ${timeBudgetMs}ms exceeded during planning.`;
      emit({ type: "error", code: "TIMEOUT", message });
      return finishDone("FAILED", message, undefined, { code: "TIMEOUT", message });
    }
    if (userSignal.aborted || isAbortError(error)) {
      return finishDone("CANCELLED", "Cancelled before planning finished.");
    }
    const message = errorMessage(error);
    emit({ type: "error", code: "PLANNER_FAILED", message });
    return finishDone("FAILED", `Planning failed: ${message}`, undefined, {
      code: "PLANNER_FAILED",
      message,
    });
  }

  const tools = createAgentTools(opts.workspace, {
    maxOutputBytes: maxToolOutputBytes,
    toolTimeoutMs,
  });

  const priorFailures: string[] = [];
  let replans = 0;

  const runExecutorNative = async (): Promise<ExecutorRunOutcome> => {
    const loopController = new AbortController();
    const combined = AbortSignal.any([loopController.signal, baseSignal]);
    const tracker = new StuckTracker(maxStuckRepeats);
    const callStartedAt = new Map<string, number>();
    const messages: ModelMessage[] = [
      { role: "user", content: buildExecutorUserMessage(opts.task, plan) },
    ];
    let finish: FinishInput | undefined;
    let stuckReason: string | undefined;
    let streamError: string | undefined;
    let stepsThisRun = 0;
    let callCounter = 0;

    const result = streamText({
      model: opts.executorModel,
      instructions: EXECUTOR_INSTRUCTIONS,
      messages,
      tools,
      stopWhen: [isStepCount(maxSteps), hasToolCall("finish")],
      toolChoice: "auto",
      maxRetries,
      abortSignal: combined,
      prepareStep: async ({ messages: current }) => ({
        messages: trimToTokenBudget(current, historyTokenBudget),
      }),
    });

    try {
      for await (const part of result.stream) {
        if (part.type === "text-delta") {
          emit({ type: "text", text: part.text });
        } else if (part.type === "tool-call") {
          const id = part.toolCallId || `call-${++callCounter}`;
          callStartedAt.set(id, Date.now());
          tracker.observe(part.toolName, part.input);
          emit({ type: "tool_call", id, name: part.toolName, args: part.input });
          stepsThisRun += 1;
          totalSteps += 1;

          const repeats = tracker.identicalRepeat(part.toolName, part.input);
          if (repeats > tracker.repeatsAllowed) {
            stuckReason = `identical ${part.toolName} call repeated ${repeats} times`;
          }
          if (part.toolName === "finish") {
            const parsed = finishInput.safeParse(part.input);
            finish = parsed.success
              ? parsed.data
              : { success: false, summary: "finish called with invalid arguments" };
          }
        } else if (part.type === "tool-result") {
          const id = part.toolCallId;
          const isError = (part as { isError?: boolean }).isError;
          const ok = toolOutputOk(part.output, isError);
          tracker.recordResult(ok);
          emit({
            type: "tool_result",
            id,
            name: part.toolName,
            ok,
            output: part.output,
            durationMs: Date.now() - (callStartedAt.get(id) ?? Date.now()),
          });
          if (tracker.consecutiveFailures >= 3 && !stuckReason) {
            stuckReason = `${tracker.consecutiveFailures} consecutive tool failures`;
          }
        } else if (part.type === "error") {
          const error = (part as { error?: unknown }).error;
          streamError = errorMessage(error);
          emit({ type: "error", code: "STREAM_ERROR", message: streamError });
        } else if (part.type === "abort") {
          break;
        }

        if (stuckReason) {
          loopController.abort();
          break;
        }
      }
    } catch (error) {
      if (!isAbortError(error)) {
        streamError = errorMessage(error);
        emit({ type: "error", code: "EXECUTOR_FAILED", message: streamError });
      }
    }

    return {
      finish,
      stuckReason,
      stepLimitReached: !finish && !stuckReason && !baseSignal.aborted && !streamError,
      abortedBySignal: baseSignal.aborted,
      streamError,
      steps: stepsThisRun,
    };
  };

  const runExecutorJson = async (): Promise<ExecutorRunOutcome> => {
    const messages: ModelMessage[] = [
      { role: "user", content: buildExecutorUserMessage(opts.task, plan) },
    ];
    const tracker = new StuckTracker(maxStuckRepeats);
    let finish: FinishInput | undefined;
    let stuckReason: string | undefined;
    let invalidActions = 0;
    let stepsThisRun = 0;
    let callCounter = 0;

    for (let step = 0; step < maxSteps; step++) {
      if (baseSignal.aborted) break;
      let text: string;
      try {
        const response = await generateText({
          model: opts.executorModel,
          instructions: JSON_ACTION_INSTRUCTIONS,
          messages,
          maxRetries,
          abortSignal: baseSignal,
        });
        text = response.text;
      } catch (error) {
        if (isAbortError(error) || baseSignal.aborted) break;
        const message = errorMessage(error);
        emit({ type: "error", code: "EXECUTOR_FAILED", message });
        return {
          stuckReason,
          stepLimitReached: false,
          abortedBySignal: baseSignal.aborted,
          streamError: message,
          steps: stepsThisRun,
        };
      }

      emit({ type: "text", text });
      messages.push({ role: "assistant", content: text });

      const action = parseAction(text);
      if (!action) {
        invalidActions += 1;
        messages.push({ role: "user", content: invalidActionRetryMessage() });
        if (invalidActions >= 3) {
          stuckReason = `${invalidActions} consecutive invalid actions`;
          break;
        }
        continue;
      }
      invalidActions = 0;

      const id = `call-${++callCounter}`;
      const started = Date.now();
      tracker.observe(action.tool, action);
      emit({ type: "tool_call", id, name: action.tool, args: action });
      stepsThisRun += 1;
      totalSteps += 1;

      const repeats = tracker.identicalRepeat(action.tool, action);
      if (repeats > tracker.repeatsAllowed) {
        stuckReason = `identical ${action.tool} call repeated ${repeats} times`;
      }

      const output = await executeAction(opts.workspace, action, {
        maxOutputBytes: maxToolOutputBytes,
        toolTimeoutMs,
      });
      const ok = toolOutputOk(output, false);
      tracker.recordResult(ok);
      emit({
        type: "tool_result",
        id,
        name: action.tool,
        ok,
        output,
        durationMs: Date.now() - started,
      });
      if (tracker.consecutiveFailures >= 3 && !stuckReason) {
        stuckReason = `${tracker.consecutiveFailures} consecutive tool failures`;
      }

      const serialized = JSON.stringify(output).slice(0, maxToolOutputBytes);
      messages.push({ role: "user", content: `Tool result:\n${serialized}` });

      if (action.tool === "finish") {
        finish = finishInput.safeParse(action).success
          ? (action as FinishInput)
          : { success: false, summary: "finish called with invalid arguments" };
        break;
      }
      if (stuckReason) break;
    }

    return {
      finish,
      stuckReason,
      stepLimitReached: !finish && !stuckReason && !baseSignal.aborted,
      abortedBySignal: baseSignal.aborted,
      steps: stepsThisRun,
    };
  };

  for (;;) {
    if (userSignal.aborted) {
      return finishDone("CANCELLED", "Cancelled by user.");
    }
    if (deadlineSignal.aborted) {
      const message = `Time budget of ${timeBudgetMs}ms exceeded.`;
      emit({ type: "error", code: "TIMEOUT", message });
      return finishDone("FAILED", message, undefined, { code: "TIMEOUT", message });
    }

    const outcome =
      toolMode === "native" ? await runExecutorNative() : await runExecutorJson();

    if (outcome.finish) {
      const finish = outcome.finish;
      if (finish.success) {
        return finishDone("SUCCEEDED", finish.summary, finish);
      }
      const message = finish.summary || "Task finished unsuccessfully.";
      emit({ type: "error", code: "TASK_FAILED", message });
      return finishDone("FAILED", message, finish, { code: "TASK_FAILED", message });
    }

    if (outcome.abortedBySignal && !outcome.stuckReason) {
      if (userSignal.aborted) {
        return finishDone("CANCELLED", "Cancelled by user.");
      }
      const message = `Time budget of ${timeBudgetMs}ms exceeded.`;
      emit({ type: "error", code: "TIMEOUT", message });
      return finishDone("FAILED", message, undefined, { code: "TIMEOUT", message });
    }

    if (outcome.stuckReason) {
      if (replans < maxReplans) {
        replans += 1;
        priorFailures.push(outcome.stuckReason);
        try {
          plan = await makePlan(priorFailures);
        } catch (error) {
          if (isAbortError(error) || baseSignal.aborted) {
            return finishDone(
              "CANCELLED",
              "Cancelled during replanning.",
            );
          }
          const message = `Replanning failed: ${errorMessage(error)}`;
          emit({ type: "error", code: "PLANNER_FAILED", message });
          return finishDone("FAILED", message, undefined, {
            code: "PLANNER_FAILED",
            message,
          });
        }
        emit({ type: "replan", reason: outcome.stuckReason, plan });
        continue;
      }
      const message = `Stuck: ${outcome.stuckReason} (no replans left)`;
      emit({ type: "error", code: "STUCK", message });
      return finishDone("FAILED", message, undefined, { code: "STUCK", message });
    }

    if (outcome.streamError) {
      const message = `Executor error: ${outcome.streamError}`;
      return finishDone("FAILED", message, undefined, {
        code: "EXECUTOR_FAILED",
        message: outcome.streamError,
      });
    }

    const message = `Executor used all ${maxSteps} steps without calling finish.`;
    emit({ type: "error", code: "STEP_LIMIT", message });
    return finishDone("FAILED", message, undefined, {
      code: "STEP_LIMIT",
      message,
    });
  }
}
