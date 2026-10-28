import IORedis from "ioredis";
import { Prisma, prisma } from "@kairo/db";
import { runEventsChannel, type PublishedStep, type RunEvent } from "@kairo/run-queue";

const MAX_STEP_PAYLOAD_BYTES = 100_000;

function clampEventForDb(event: RunEvent): Prisma.InputJsonValue {
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

export async function maxSeqFor(runId: string): Promise<number> {
  const aggregate = await prisma.agentStep.aggregate({
    where: { runId },
    _max: { seq: true },
  });
  return aggregate._max.seq ?? 0;
}

/**
 * One seq sequence per run: persist AgentStep, then publish {seq, event} on
 * the run's Redis channel so the API's SSE relay (and reconnect replays) see
 * exactly the same stream.
 */
export class StepEmitter {
  private seq: number;
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly runId: string,
    startSeq: number,
    private readonly redis: IORedis,
  ) {
    this.seq = startSeq;
  }

  emit(event: RunEvent): number {
    this.seq += 1;
    const seq = this.seq;
    const step: PublishedStep = { seq, event };
    this.writes = this.writes
      .then(async () => {
        await prisma.agentStep
          .create({
            data: {
              runId: this.runId,
              seq,
              type: event.type,
              payload: clampEventForDb(event),
            },
          })
          .catch(() => undefined);
        await this.redis
          .publish(runEventsChannel(this.runId), JSON.stringify(step))
          .catch(() => undefined);
      });
    return seq;
  }

  async flush(): Promise<void> {
    await this.writes;
  }
}

/** Coalesces streaming part updates: emit at most every `everyMs` per key. */
export class PartThrottle {
  private readonly pending = new Map<string, { event: RunEvent; last: number }>();

  constructor(
    private readonly emit: (event: RunEvent) => void,
    private readonly everyMs = 300,
  ) {}

  push(key: string, event: RunEvent, force = false): void {
    const now = Date.now();
    const existing = this.pending.get(key);
    if (!force && existing !== undefined && now - existing.last < this.everyMs) {
      this.pending.set(key, { event, last: existing.last });
      return;
    }
    this.pending.set(key, { event, last: now });
    this.emit(event);
  }

  flushAll(): void {
    const now = Date.now();
    for (const [key, entry] of this.pending) {
      this.pending.set(key, { event: entry.event, last: now });
      this.emit(entry.event);
    }
  }
}
