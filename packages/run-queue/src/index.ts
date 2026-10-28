import IORedis from "ioredis";

export const RUN_QUEUE_NAME = "kairo-runs";

export interface RunJobData {
  runId: string;
  userId: string;
}

export type RunEvent =
  | { type: "workspace"; state: "starting" | "ready" }
  | { type: "text"; text: string; done?: boolean }
  | { type: "reasoning"; text: string; done?: boolean }
  | {
      type: "tool";
      name: string;
      state: "running" | "done" | "error";
      input?: unknown;
      output?: string;
      callId?: string;
    }
  | { type: "edit"; path: string; state?: "running" | "done" | "error" }
  | { type: "error"; code: string; message: string }
  | {
      type: "done";
      status: "SUCCEEDED" | "FAILED" | "CANCELLED";
      summary: string;
      tokensIn?: number;
      tokensOut?: number;
      prUrl?: string;
      error?: { code: string; message: string };
    };

export function defaultRedisUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.REDIS_URL?.trim() || "redis://127.0.0.1:6379";
}

/** Fresh connection (BullMQ consumers need maxRetriesPerRequest: null). */
export function createRedis(url: string = defaultRedisUrl()): IORedis {
  return new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

export function runEventsChannel(runId: string): string {
  return `run:${runId}:events`;
}

export function runSeqKey(runId: string): string {
  return `run:${runId}:seq`;
}

export function runCancelKey(runId: string): string {
  return `run:${runId}:cancel`;
}

export interface PublishedStep {
  seq: number;
  event: RunEvent;
}
