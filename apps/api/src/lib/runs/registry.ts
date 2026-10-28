import type { AgentEvent } from "@kairo/agent";

export interface StoredEvent {
  seq: number;
  event: AgentEvent;
}

export interface RunChannel {
  runId: string;
  userId: string;
  events: StoredEvent[];
  controller: AbortController;
  closed: boolean;
  waiters: Array<() => void>;
}

const MAX_STEP_PAYLOAD_BYTES = 100_000;export class RunRegistry {
  private readonly channels = new Map<string, RunChannel>();
  private readonly activeByUser = new Map<string, string>();

  open(runId: string, userId: string): RunChannel {
    const channel: RunChannel = {
      runId,
      userId,
      events: [],
      controller: new AbortController(),
      closed: false,
      waiters: [],
    };
    this.channels.set(runId, channel);
    this.activeByUser.set(userId, runId);
    return channel;
  }

  get(runId: string): RunChannel | undefined {
    return this.channels.get(runId);
  }

  activeRunIdFor(userId: string): string | undefined {
    return this.activeByUser.get(userId);
  }

  push(runId: string, event: AgentEvent): StoredEvent | null {
    const channel = this.channels.get(runId);
    if (!channel || channel.closed) return null;
    const seq = channel.events.length + 1;
    const stored: StoredEvent = { seq, event };
    channel.events.push(stored);
    for (const waiter of channel.waiters.splice(0)) waiter();
    if (event.type === "done") {
      channel.closed = true;
      this.channels.delete(runId);
      this.activeByUser.delete(channel.userId);
    }
    return stored;
  }

  cancel(runId: string): void {
    const channel = this.channels.get(runId);
    if (channel && !channel.closed) {
      channel.controller.abort(new Error("CANCELLED_BY_USER"));
    }
  }

  /** Terminal cleanup for externally-finalized runs (crash, restart path). */
  close(runId: string, event: AgentEvent): void {
    const channel = this.channels.get(runId);
    if (!channel || channel.closed) return;
    this.push(runId, event);
    if (this.channels.get(runId) === channel) {
      channel.closed = true;
      for (const waiter of channel.waiters.splice(0)) waiter();
      this.channels.delete(runId);
      this.activeByUser.delete(channel.userId);
    }
  }

  remove(runId: string): void {
    const channel = this.channels.get(runId);
    if (channel && !channel.closed) {
      channel.closed = true;
      for (const waiter of channel.waiters.splice(0)) waiter();
      this.channels.delete(runId);
      this.activeByUser.delete(channel.userId);
    }
  }

  /** Truncation applied before AgentStep persistence (respect .db limit). */
  static clampForDb(event: AgentEvent): string {
    const json = JSON.stringify(event) ?? "null";
    if (json.length <= MAX_STEP_PAYLOAD_BYTES) return json;
    const clipped = `${json.slice(0, MAX_STEP_PAYLOAD_BYTES)}…[truncated]`;
    return JSON.stringify({ type: (event as { type?: string }).type ?? "unknown", clipped: true, json: clipped });
  }
}
