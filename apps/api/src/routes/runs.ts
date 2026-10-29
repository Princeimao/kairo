import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "@kairo/db";
import {
  createRedis,
  runAskAnswerKey,
  runAskPendingKey,
} from "@kairo/run-queue";
import { AppError } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.js";
import { startRun } from "../lib/sessions.js";
import { requestRunCancel, subscribeRunEvents } from "../lib/relay.js";
import type { RunEvent } from "@kairo/run-queue";

export const runRouter = Router();

const heartbeatsMs = 15_000;
const watchdogMs = 4_000;

function authenticatedUser(req: Request): string {
  const id = req.auth?.user.id;
  if (!id) throw new AppError(401, "Authentication required");
  return id;
}

function runIdFromParams(req: Request): string {
  const raw = req.params.id;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError(400, "Missing run id");
  }
  return value;
}

function parseCursor(req: Request): number {
  const raw =
    req.get("last-event-id") ??
    (typeof req.query.after === "string" ? req.query.after : undefined);
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function serializeRun(row: {
  id: string;
  status: string;
  mode: string;
  prompt: string;
  conversationId: string | null;
  repoFullName: string | null;
  prUrl: string | null;
  errorMessage: string | null;
  tokensIn: number;
  tokensOut: number;
  createdAt: Date;
  finishedAt: Date | null;
}) {
  return {
    id: row.id,
    status: row.status,
    mode: row.mode,
    prompt: row.prompt,
    conversationId: row.conversationId,
    repoFullName: row.repoFullName,
    prUrl: row.prUrl,
    errorMessage: row.errorMessage,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

function isTerminalStatus(status: string): boolean {
  return (
    status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED"
  );
}

async function loadOwnedRun(runId: string, userId: string) {
  const run = await prisma.agentRun.findFirst({ where: { id: runId, userId } });
  if (!run) throw new AppError(404, "Run not found");
  return run;
}

/**
 * POST /runs — queue-first: row + USER message + BullMQ job. Same body shape
 * as before ({prompt, mode}) plus optional conversationId to continue a thread.
 */
runRouter.post("/", requireAuth, async (req, res, next) => {
  try {
    const body = z
      .object({
        prompt: z.string().trim().min(3, "prompt is too short").max(8_000),
        mode: z.enum(["CREATE", "FIX"]).optional().default("CREATE"),
        conversationId: z.string().trim().min(1).optional(),
        sessionId: z.string().trim().min(1).optional(),
        repoFullName: z.string().trim().max(200).optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      throw new AppError(
        400,
        `Invalid request: ${body.error.issues[0]?.message ?? "bad body"}`,
      );
    }
    const started = await startRun({
      userId: authenticatedUser(req),
      prompt: body.data.prompt,
      mode: body.data.mode,
      conversationId: body.data.conversationId,
      sessionId: body.data.sessionId,
      repoFullName: body.data.repoFullName,
    });
    res.status(202).json({ ...started, status: "QUEUED" });
  } catch (err) {
    next(err);
  }
});

runRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const runs = await prisma.agentRun.findMany({
      where: { userId: authenticatedUser(req) },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json({ runs: runs.map(serializeRun) });
  } catch (err) {
    next(err);
  }
});

runRouter.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const run = await loadOwnedRun(
      runIdFromParams(req),
      authenticatedUser(req),
    );
    const stepCount = await prisma.agentStep.count({
      where: { runId: run.id },
    });
    res.json({ run: serializeRun(run), steps: stepCount });
  } catch (err) {
    next(err);
  }
});

runRouter.post("/:id/cancel", requireAuth, async (req, res, next) => {
  try {
    const run = await loadOwnedRun(
      runIdFromParams(req),
      authenticatedUser(req),
    );
    if (isTerminalStatus(run.status)) {
      res.json({ ok: true, cancelled: true });
      return;
    }
    await requestRunCancel(run.id);
    if (run.status === "QUEUED") {
      // No worker picked it up yet — finalize now; a worker that starts later
      // sees the terminal status (and the cancel key) and drops the job.
      await prisma.agentRun.updateMany({
        where: { id: run.id, status: "QUEUED" },
        data: { status: "CANCELLED", finishedAt: new Date() },
      });
    }
    res.json({ ok: true, cancelling: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /runs/:id/answers {askId, approved, note?} — the UI's reply to a
 * pending `ask` event. Writes the answer key the worker/agent long-poll reads;
 * the pending marker is cleared so the question cannot be answered twice.
 */
runRouter.post("/:id/answers", requireAuth, async (req, res, next) => {
  try {
    const run = await loadOwnedRun(
      runIdFromParams(req),
      authenticatedUser(req),
    );
    if (isTerminalStatus(run.status)) {
      throw new AppError(409, "Run already finished");
    }
    const body = z
      .object({
        askId: z.string().trim().min(1).max(64),
        approved: z.boolean(),
        note: z.string().trim().max(4_000).optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      throw new AppError(400, "askId and approved are required");
    }

    const redis = createRedis();
    try {
      const pending = await redis.get(runAskPendingKey(run.id));
      if (pending !== body.data.askId) {
        throw new AppError(409, "No matching pending question for this run");
      }
      await redis.set(
        runAskAnswerKey(run.id, body.data.askId),
        JSON.stringify({
          approved: body.data.approved,
          note: body.data.note ?? null,
          at: new Date().toISOString(),
        }),
        "EX",
        60 * 60 * 24,
      );
      await redis.del(runAskPendingKey(run.id));
    } finally {
      redis.disconnect();
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /runs/:id/events — SSE: replay persisted steps after the cursor, then
 * relay live Redis events from the worker. `id:` lines are step seq numbers,
 * so Last-Event-ID reconnects replay exactly what was missed.
 */
runRouter.get("/:id/events", requireAuth, async (req, res, next) => {
  try {
    const run = await loadOwnedRun(
      runIdFromParams(req),
      authenticatedUser(req),
    );
    const cursor = parseCursor(req);
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(`retry: 2000\n\n`);

    let closed = false;
    let lastSeq = cursor;
    const clearTimers: Array<() => void> = [];
    const unsubscribeHolder: { fn?: () => void } = {};

    const finish = (): void => {
      if (closed) return;
      closed = true;
      for (const clear of clearTimers.splice(0)) clear();
      unsubscribeHolder.fn?.();
      res.end();
    };
    req.on("close", () => {
      closed = true;
      for (const clear of clearTimers.splice(0)) clear();
      unsubscribeHolder.fn?.();
    });

    const send = (seq: number, event: RunEvent): void => {
      if (closed || seq <= lastSeq) return;
      lastSeq = seq;
      res.write(`id: ${seq}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    const heartbeat = setInterval(() => {
      if (!closed) res.write(`: keepalive\n\n`);
    }, heartbeatsMs);
    clearTimers.push(() => clearInterval(heartbeat));

    const handleStep = (step: { seq: number; event: RunEvent }): void => {
      if (closed || step.seq <= lastSeq) return;
      send(step.seq, step.event);
      if (step.event.type === "done") finish();
    };

    // Subscribe before replay so nothing published in between is lost.
    const buffer: Array<{ seq: number; event: RunEvent }> = [];
    let replaying = true;
    unsubscribeHolder.fn = subscribeRunEvents(run.id, (step) => {
      if (replaying) buffer.push(step);
      else handleStep(step);
    });

    try {
      const steps = await prisma.agentStep.findMany({
        where: { runId: run.id, seq: { gt: cursor } },
        orderBy: { seq: "asc" },
      });
      let sawDone = false;
      for (const step of steps) {
        const event = step.payload as RunEvent;
        if (step.seq > lastSeq) {
          lastSeq = step.seq;
          res.write(`id: ${step.seq}\ndata: ${JSON.stringify(event)}\n\n`);
        }
        if (step.type === "done" || event.type === "done") sawDone = true;
      }
      replaying = false;
      for (const buffered of buffer.splice(0)) handleStep(buffered);
      if (sawDone || closed) {
        finish();
        return;
      }

      const syntheticDone = (status: string, summary: string): RunEvent => ({
        type: "done",
        status: (isTerminalStatus(status) ? status : "FAILED") as
          | "SUCCEEDED"
          | "FAILED"
          | "CANCELLED",
        summary,
      });

      if (isTerminalStatus(run.status)) {
        send(lastSeq + 1, syntheticDone(run.status, run.errorMessage ?? "Run finished."));
        finish();
        return;
      }

      // Live phase: if the worker dies without publishing done (crash,
      // restart), the DB status still flips — watchdog converts that into a
      // terminal event so the stream always ends.
      const watchdog = setInterval(() => {
        if (closed) return;
        void prisma.agentRun
          .findUnique({
            where: { id: run.id },
            select: { status: true, errorMessage: true },
          })
          .then((fresh) => {
            if (!fresh || closed) return;
            if (isTerminalStatus(fresh.status)) {
              send(
                lastSeq + 1,
                syntheticDone(
                  fresh.status,
                  fresh.errorMessage ?? "Run finished.",
                ),
              );
              finish();
            }
          })
          .catch(() => undefined);
      }, watchdogMs);
      clearTimers.push(() => clearInterval(watchdog));
    } catch {
      finish();
    }
  } catch (err) {
    next(err);
  }
});
