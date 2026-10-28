import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "@kairo/db";
import { DockerWorkspace } from "@kairo/sandbox";
import type { AgentEvent } from "@kairo/agent";
import { AppError } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.js";
import { startRun } from "../lib/runs/executor.js";
import { RunRegistry } from "../lib/runs/registry.js";

const registry = new RunRegistry();

export const runRouter = Router();

const heartbeatsMs = 15_000;

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
  createdAt: Date;
  finishedAt: Date | null;
}) {
  return {
    id: row.id,
    status: row.status,
    mode: row.mode,
    prompt: row.prompt,
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

function sendEvent(
  res: { write(chunk: string): boolean },
  seq: number,
  event: AgentEvent,
): void {
  res.write(`id: ${seq}\ndata: ${JSON.stringify(event)}\n\n`);
}

function streamFromChannel(
  channel: NonNullable<ReturnType<RunRegistry["get"]>>,
  res: { write(chunk: string): boolean; end(cb?: () => void): void },
  req: Request,
  initialCursor: number,
): void {
  let cursor = initialCursor;
  let disconnected = false;

  const finish = (): void => {
    if (disconnected) return;
    disconnected = true;
    res.end();
  };

  req.on("close", () => {
    disconnected = true;
  });
  const heartbeat = setInterval(() => {
    if (disconnected) return;
    res.write(`: keepalive\n\n`);
  }, heartbeatsMs);

  const drain = async (): Promise<void> => {
    try {
      for (;;) {
        if (disconnected) return;
        const upcoming = channel.events[cursor];
        if (upcoming) {
          sendEvent(res, upcoming.seq, upcoming.event);
          cursor = upcoming.seq;
          continue;
        }
        if (channel.closed && cursor >= channel.events.length) {
          finish();
          return;
        }
        // Wait for the next push or until the keepalive interval fires.
        await new Promise<void>((resolveWait) => {
          let woken = false;
          const timer = setTimeout(() => {
            if (woken) return;
            woken = true;
            resolveWait();
          }, heartbeatsMs);
          channel.waiters.push(() => {
            if (woken) return;
            woken = true;
            clearTimeout(timer);
            resolveWait();
          });
        });
      }
    } finally {
      clearInterval(heartbeat);
      if (!disconnected) finish();
    }
  };
  void drain();
}

runRouter.post("/", requireAuth, async (req, res, next) => {
  try {
    const body = z
      .object({
        prompt: z.string().trim().min(3, "prompt is too short").max(8_000),
        mode: z.enum(["CREATE", "FIX"]).optional().default("CREATE"),
      })
      .safeParse(req.body);
    if (!body.success) {
      throw new AppError(
        400,
        `Invalid request: ${body.error.issues[0]?.message ?? "bad body"}`,
      );
    }

    const userId = authenticatedUser(req);
    const active = registry.activeRunIdFor(userId);
    if (active) {
      throw new AppError(409, `Another run is already in progress (${active})`);
    }

    const run = await prisma.agentRun.create({
      data: {
        userId,
        prompt: body.data.prompt,
        mode: body.data.mode,
        status: "RUNNING",
      },
    });
    registry.open(run.id, userId);
    const workspace = new DockerWorkspace(userId);
    startRun(registry, run.id, userId, body.data.prompt, workspace);
    res.status(202).json({ runId: run.id, status: "RUNNING" });
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
    const channel = registry.get(run.id);
    if (channel) {
      registry.cancel(run.id);
      res.json({ ok: true, cancelling: true });
      return;
    }
    if (!isTerminalStatus(run.status)) {
      // No channel means the API process restarted mid-run: finalize here.
      await prisma.agentRun.update({
        where: { id: run.id },
        data: { status: "CANCELLED", finishedAt: new Date() },
      });
      res.json({ ok: true, cancelled: true });
      return;
    }
    res.json({ ok: true, cancelled: true });
  } catch (err) {
    next(err);
  }
});

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
    const channel = registry.get(run.id);
    if (channel) {
      streamFromChannel(channel, res, req, cursor);
      return;
    }
    const steps = await prisma.agentStep.findMany({
      where: { runId: run.id, seq: { gt: cursor } },
      orderBy: { seq: "asc" },
    });
    let lastSeq = cursor;
    for (const step of steps) {
      lastSeq = step.seq;
      sendEvent(res, step.seq, step.payload as AgentEvent);
    }
    if (
      isTerminalStatus(run.status) ||
      steps.some((step) => step.type === "done")
    ) {
      res.end();
      return;
    }
    const synthetic: AgentEvent = {
      type: "done",
      status: "FAILED",
      summary:
        "Run was interrupted when the API server restarted. Start a new run.",
      steps: 0,
      durationMs: 0,
      error: {
        code: "SERVER_RESTARTED",
        message: "Run was interrupted by a server restart.",
      },
    };
    await prisma.agentRun
      .update({
        where: { id: run.id },
        data: { status: "FAILED", finishedAt: new Date() },
      })
      .catch(() => undefined);
    sendEvent(res, lastSeq + 1, synthetic);
    res.end();
  } catch (err) {
    next(err);
  }
});
