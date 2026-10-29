import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "@kairo/db";
import { AppError } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.js";
import { computeNextRunAt } from "../lib/scheduler.js";

export const scheduleRouter = Router();

const DAILY_AT_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

function authenticatedUser(req: Request): string {
  const id = req.auth?.user.id;
  if (!id) throw new AppError(401, "Authentication required");
  return id;
}

function idParam(req: Request, name: string): string {
  const raw = req.params[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError(400, `Missing ${name}`);
  }
  return value;
}

const timingSchema = {
  intervalMinutes: z.number().int().min(1).max(10_080).optional(),
  dailyAt: z.string().trim().regex(DAILY_AT_RE, "dailyAt must be HH:MM (UTC)").optional(),
};

const createBody = z
  .object({
    title: z.string().trim().max(80).optional(),
    prompt: z.string().trim().min(3).max(8_000),
    mode: z.enum(["CREATE", "FIX"]).default("CREATE"),
    ...timingSchema,
  })
  .refine(
    (data) => (data.intervalMinutes !== undefined) !== (data.dailyAt !== undefined),
    { message: "exactly one of intervalMinutes or dailyAt is required" },
  );

const patchBody = z
  .object({
    title: z.string().trim().max(80).optional(),
    prompt: z.string().trim().min(3).max(8_000).optional(),
    mode: z.enum(["CREATE", "FIX"]).optional(),
    active: z.boolean().optional(),
    ...timingSchema,
  })
  .refine(
    (data) =>
      data.intervalMinutes === undefined && data.dailyAt === undefined
        ? true
        : (data.intervalMinutes !== undefined) !== (data.dailyAt !== undefined),
    { message: "timing changes must send exactly one of intervalMinutes or dailyAt" },
  );

type ScheduleRow = {
  id: string;
  title: string;
  prompt: string;
  mode: string;
  intervalMinutes: number | null;
  dailyAt: string | null;
  active: boolean;
  nextRunAt: Date;
  lastRunAt: Date | null;
  conversationId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function serializeSchedule(row: ScheduleRow) {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    mode: row.mode,
    intervalMinutes: row.intervalMinutes,
    dailyAt: row.dailyAt,
    active: row.active,
    nextRunAt: row.nextRunAt.toISOString(),
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    conversationId: row.conversationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** GET /schedules — the user's recurring runs. */
scheduleRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const userId = authenticatedUser(req);
    const schedules = await prisma.scheduledRun.findMany({
      where: { userId },
      orderBy: { nextRunAt: "asc" },
    });
    res.json({ schedules: schedules.map(serializeSchedule) });
  } catch (err) {
    next(err);
  }
});

/** POST /schedules — create a recurring run (first fire one period away). */
scheduleRouter.post("/", requireAuth, async (req, res, next) => {
  try {
    const userId = authenticatedUser(req);
    const body = createBody.safeParse(req.body ?? {});
    if (!body.success) {
      throw new AppError(
        400,
        body.error.issues[0]?.message ?? "Invalid schedule payload",
      );
    }
    const data = body.data;
    const now = new Date();
    const schedule = await prisma.scheduledRun.create({
      data: {
        userId,
        title: data.title ?? "",
        prompt: data.prompt,
        mode: data.mode,
        intervalMinutes: data.intervalMinutes ?? null,
        dailyAt: data.dailyAt ?? null,
        nextRunAt: computeNextRunAt(
          {
            intervalMinutes: data.intervalMinutes ?? null,
            dailyAt: data.dailyAt ?? null,
          },
          now,
        ),
      },
    });
    res.status(201).json({ schedule: serializeSchedule(schedule) });
  } catch (err) {
    next(err);
  }
});

/** PATCH /schedules/:id — edit prompt/timing, pause (active:false) / resume. */
scheduleRouter.patch("/:id", requireAuth, async (req, res, next) => {
  try {
    const userId = authenticatedUser(req);
    const id = idParam(req, "id");
    const existing = await prisma.scheduledRun.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new AppError(404, "Schedule not found");

    const body = patchBody.safeParse(req.body ?? {});
    if (!body.success) {
      throw new AppError(
        400,
        body.error.issues[0]?.message ?? "Invalid schedule payload",
      );
    }
    const data = body.data;

    // Timing sent (exactly one field) replaces the pair wholesale so an old
    // dailyAt can't linger next to a new intervalMinutes.
    const timingChanged =
      data.intervalMinutes !== undefined || data.dailyAt !== undefined;
    const intervalMinutes = timingChanged
      ? (data.intervalMinutes ?? null)
      : existing.intervalMinutes;
    const dailyAt = timingChanged ? (data.dailyAt ?? null) : existing.dailyAt;

    const now = new Date();
    const reactivated = existing.active === false && data.active === true;
    const nextRunAt =
      timingChanged || reactivated
        ? computeNextRunAt({ intervalMinutes, dailyAt }, now)
        : existing.nextRunAt;

    const schedule = await prisma.scheduledRun.update({
      where: { id: existing.id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.prompt !== undefined ? { prompt: data.prompt } : {}),
        ...(data.mode !== undefined ? { mode: data.mode } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
        ...(timingChanged ? { intervalMinutes, dailyAt } : {}),
        nextRunAt,
      },
    });
    res.json({ schedule: serializeSchedule(schedule) });
  } catch (err) {
    next(err);
  }
});

/** DELETE /schedules/:id */
scheduleRouter.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const userId = authenticatedUser(req);
    const id = idParam(req, "id");
    const { count } = await prisma.scheduledRun.deleteMany({
      where: { id, userId },
    });
    if (count === 0) throw new AppError(404, "Schedule not found");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
