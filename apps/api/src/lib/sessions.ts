import { prisma } from "@kairo/db";
import { AppError } from "../middleware/error-handler.js";
import { enqueueRun } from "./queue.js";

const STALE_QUEUED_MS = 30 * 60 * 1000;

export interface StartRunInput {
  userId: string;
  prompt: string;
  mode: "CREATE" | "FIX";
  /** Append to an existing conversation (thread) instead of opening one. */
  conversationId?: string;
  /** Place a brand-new conversation inside this session. */
  sessionId?: string;
  repoFullName?: string;
}

export interface StartedRun {
  runId: string;
  conversationId: string;
  sessionId: string;
}

function titleFromPrompt(prompt: string): string {
  const clean = prompt.replace(/\s+/g, " ").trim();
  return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean || "New session";
}

async function assertNotBusy(userId: string): Promise<void> {
  // Sweep runs stranded by a dead worker so one crash can't block forever.
  const cutoff = new Date(Date.now() - STALE_QUEUED_MS);
  await prisma.agentRun.updateMany({
    where: {
      userId,
      status: { in: ["QUEUED", "RUNNING"] },
      createdAt: { lt: cutoff },
    },
    data: { status: "FAILED", finishedAt: new Date(), errorMessage: "Run timed out (worker did not finish it)." },
  });
  const active = await prisma.agentRun.findFirst({
    where: { userId, status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
  });
  if (active) {
    throw new AppError(409, `Another run is already in progress (${active.id})`);
  }
}

/**
 * Creates (or reuses) the conversation, stores the USER message, creates the
 * run row as QUEUED and enqueues it. One place so POST /runs and the
 * sessions endpoints behave identically.
 */
export async function startRun(input: StartRunInput): Promise<StartedRun> {
  await assertNotBusy(input.userId);

  let sessionId: string;
  if (input.conversationId !== undefined) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: input.conversationId, userId: input.userId },
    });
    if (!conversation) throw new AppError(404, "Conversation not found");
    sessionId = conversation.sessionId;
  } else if (input.sessionId !== undefined) {
    const session = await prisma.chatSession.findFirst({
      where: { id: input.sessionId, userId: input.userId },
    });
    if (!session) throw new AppError(404, "Session not found");
    sessionId = session.id;
  } else {
    const session = await prisma.chatSession.create({
      data: { userId: input.userId, title: titleFromPrompt(input.prompt) },
    });
    sessionId = session.id;
  }

  const conversation =
    input.conversationId !== undefined
      ? await prisma.conversation.findUniqueOrThrow({
          where: { id: input.conversationId },
        })
      : await prisma.conversation.create({
          data: { sessionId, userId: input.userId, mode: input.mode },
        });

  const run = await prisma.agentRun.create({
    data: {
      userId: input.userId,
      prompt: input.prompt,
      mode: input.mode,
      conversationId: conversation.id,
      repoFullName: input.repoFullName ?? null,
      status: "QUEUED",
    },
  });
  await prisma.message.create({
    data: { conversationId: conversation.id, role: "USER", content: input.prompt },
  });

  try {
    await enqueueRun({ runId: run.id, userId: input.userId });
  } catch (error) {
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: `Could not queue run: ${error instanceof Error ? error.message : String(error)}`,
      },
    });
    throw new AppError(503, "Could not queue the run — is Redis running? (REDIS_URL)");
  }

  return { runId: run.id, conversationId: conversation.id, sessionId };
}
