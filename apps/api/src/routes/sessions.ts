import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "@kairo/db";
import { AppError } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.js";
import { startRun } from "../lib/sessions.js";

export const sessionRouter = Router();
export const conversationRouter = Router();

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

function serializeConversation(row: {
  id: string;
  mode: string;
  createdAt: Date;
  updatedAt: Date;
  messages?: Array<{ role: string; content: string; createdAt: Date }>;
}) {
  const last = row.messages?.[row.messages.length - 1];
  return {
    id: row.id,
    mode: row.mode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    preview: last ? last.content.slice(0, 120) : null,
    lastRole: last?.role ?? null,
  };
}

/** GET /sessions — sidebar: sessions newest-first with their conversations. */
sessionRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const userId = authenticatedUser(req);
    const sessions = await prisma.chatSession.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: {
        conversations: {
          orderBy: { createdAt: "asc" },
          include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
        },
      },
    });
    res.json({
      sessions: sessions.map((session) => ({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
        conversations: session.conversations.map(serializeConversation),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** POST /sessions {title?} — pre-create an empty session. */
sessionRouter.post("/", requireAuth, async (req, res, next) => {
  try {
    const body = z
      .object({ title: z.string().trim().min(1).max(80).optional() })
      .safeParse(req.body ?? {});
    if (!body.success) throw new AppError(400, "Invalid session payload");
    const session = await prisma.chatSession.create({
      data: {
        userId: authenticatedUser(req),
        title: body.data.title ?? "New session",
      },
    });
    res.status(201).json({
      session: {
        id: session.id,
        title: session.title,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
        conversations: [],
      },
    });
  } catch (err) {
    next(err);
  }
});

/** GET /sessions/:id */
sessionRouter.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const session = await prisma.chatSession.findFirst({
      where: { id: idParam(req, "id"), userId: authenticatedUser(req) },
      include: {
        conversations: {
          orderBy: { createdAt: "asc" },
          include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
        },
      },
    });
    if (!session) throw new AppError(404, "Session not found");
    res.json({
      session: {
        id: session.id,
        title: session.title,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
        conversations: session.conversations.map(serializeConversation),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /sessions/:id/conversations {prompt, mode} — new conversation inside
 * the session, first message, run queued. Returns runId for SSE attach.
 */
sessionRouter.post("/:id/conversations", requireAuth, async (req, res, next) => {
  try {
    const body = z
      .object({
        prompt: z.string().trim().min(3, "prompt is too short").max(8_000),
        mode: z.enum(["CREATE", "FIX"]).optional().default("CREATE"),
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
      sessionId: idParam(req, "id"),
      repoFullName: body.data.repoFullName,
    });
    res.status(202).json({ ...started, status: "QUEUED" });
  } catch (err) {
    next(err);
  }
});

/** GET /conversations/:id — thread view: all messages, oldest first. */
conversationRouter.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: idParam(req, "id"), userId: authenticatedUser(req) },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
        runs: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { id: true, status: true, createdAt: true, finishedAt: true },
        },
      },
    });
    if (!conversation) throw new AppError(404, "Conversation not found");
    res.json({
      conversation: {
        id: conversation.id,
        sessionId: conversation.sessionId,
        mode: conversation.mode,
        createdAt: conversation.createdAt.toISOString(),
        messages: conversation.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          runId: message.runId,
          createdAt: message.createdAt.toISOString(),
        })),
        runs: conversation.runs.map((run) => ({
          id: run.id,
          status: run.status,
          createdAt: run.createdAt.toISOString(),
          finishedAt: run.finishedAt?.toISOString() ?? null,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /conversations/:id/messages {prompt, mode} — continue an existing
 * thread: stores the USER message and queues the next run.
 */
conversationRouter.post("/:id/messages", requireAuth, async (req, res, next) => {
  try {
    const body = z
      .object({
        prompt: z.string().trim().min(3, "prompt is too short").max(8_000),
        mode: z.enum(["CREATE", "FIX"]).optional().default("CREATE"),
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
      conversationId: idParam(req, "id"),
      repoFullName: body.data.repoFullName,
    });
    res.status(202).json({ ...started, status: "QUEUED" });
  } catch (err) {
    next(err);
  }
});
