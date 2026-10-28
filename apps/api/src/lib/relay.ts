import IORedis from "ioredis";
import {
  createRedis,
  defaultRedisUrl,
  runCancelKey,
  runEventsChannel,
  type PublishedStep,
} from "@kairo/run-queue";

let subscriber: IORedis | undefined;
let subscribing: Promise<void> | undefined;
const handlers = new Map<string, Set<(step: PublishedStep) => void>>();

function handleMessage(channel: string, message: string): void {
  const prefix = "run:";
  const suffix = ":events";
  if (!channel.startsWith(prefix) || !channel.endsWith(suffix)) return;
  const runId = channel.slice(prefix.length, channel.length - suffix.length);
  const set = handlers.get(runId);
  if (!set || set.size === 0) return;
  let step: PublishedStep;
  try {
    step = JSON.parse(message) as PublishedStep;
  } catch {
    return;
  }
  for (const handler of set) handler(step);
}

/**
 * Subscribes to a run's event channel. One shared Redis connection with a
 * pattern subscription; each run registers its own handler. Returns an
 * unsubscribe function (the Redis subscription itself stays warm).
 */
export function subscribeRunEvents(
  runId: string,
  onStep: (step: PublishedStep) => void,
): () => void {
  if (subscriber === undefined) {
    subscriber = createRedis();
    subscriber.on("pmessage", (_pattern, channel, message) =>
      handleMessage(channel, message),
    );
    subscribing = subscriber.psubscribe("run:*:events").then(() => undefined);
  }
  void subscribing;
  let set = handlers.get(runId);
  if (set === undefined) {
    set = new Set();
    handlers.set(runId, set);
  }
  set.add(onStep);
  return () => {
    set?.delete(onStep);
    if (set && set.size === 0) handlers.delete(runId);
  };
}

function ephemeralRedis(): IORedis {
  return new IORedis(defaultRedisUrl(), {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

/** Flag the worker polls; set by POST /runs/:id/cancel. */
export async function requestRunCancel(runId: string): Promise<void> {
  const redis = ephemeralRedis();
  try {
    await redis.set(runCancelKey(runId), "1", "EX", 60 * 60);
  } finally {
    redis.disconnect();
  }
}

/** Test helper: publish a step exactly like the worker does. */
export async function publishRunStep(
  runId: string,
  step: PublishedStep,
): Promise<void> {
  const redis = ephemeralRedis();
  try {
    await redis.publish(runEventsChannel(runId), JSON.stringify(step));
  } finally {
    redis.disconnect();
  }
}

export { runEventsChannel };
