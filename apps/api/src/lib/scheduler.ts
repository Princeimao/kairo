import { prisma } from "@kairo/db";
import { startRun } from "./sessions.js";

const TICK_MS = 20_000;
const MAX_FIRES_PER_TICK = 10;

type ScheduleTiming = {
  intervalMinutes: number | null;
  dailyAt: string | null;
};

/**
 * Next fire strictly after `from`: now + interval, or the next occurrence of
 * the daily HH:MM slot (UTC). Falls back to +1h when neither is set.
 */
export function computeNextRunAt(schedule: ScheduleTiming, from: Date): Date {
  if (schedule.intervalMinutes !== null) {
    return new Date(from.getTime() + schedule.intervalMinutes * 60_000);
  }
  if (schedule.dailyAt !== null) {
    const [hourText, minuteText] = schedule.dailyAt.split(":");
    const next = new Date(from);
    next.setUTCHours(Number(hourText), Number(minuteText), 0, 0);
    if (next.getTime() <= from.getTime()) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    return next;
  }
  return new Date(from.getTime() + 60 * 60_000);
}

let ticking = false;

/**
 * Fires every due schedule exactly once per period: nextRunAt is advanced
 * BEFORE startRun, so a busy user (409) or a crash can't double-fire or pile
 * up retries — the period is simply skipped and logged.
 */
export async function schedulerTick(now: Date = new Date()): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const due = await prisma.scheduledRun.findMany({
      where: { active: true, nextRunAt: { lte: now } },
      orderBy: { nextRunAt: "asc" },
      take: MAX_FIRES_PER_TICK,
    });
    for (const schedule of due) {
      const nextRunAt = computeNextRunAt(schedule, now);
      await prisma.scheduledRun.update({
        where: { id: schedule.id },
        data: { nextRunAt, lastRunAt: now },
      });
      try {
        const started = await startRun({
          userId: schedule.userId,
          prompt: schedule.prompt,
          mode: schedule.mode,
          ...(schedule.conversationId !== null
            ? { conversationId: schedule.conversationId }
            : {}),
        });
        if (schedule.conversationId === null) {
          await prisma.scheduledRun.update({
            where: { id: schedule.id },
            data: { conversationId: started.conversationId },
          });
        }
        console.log(
          `[scheduler] fired schedule=${schedule.id} run=${started.runId} next=${nextRunAt.toISOString()}`,
        );
      } catch (error) {
        console.warn(
          `[scheduler] skipped schedule=${schedule.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } catch (error) {
    console.warn(
      `[scheduler] tick failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    ticking = false;
  }
}

/** Starts the in-process ticker (single API instance — dev + prod alike). */
export function startScheduler(): () => void {
  const timer = setInterval(() => void schedulerTick(), TICK_MS);
  return () => clearInterval(timer);
}
