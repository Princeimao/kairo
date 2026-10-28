import { Router, type Request, type Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma, prisma } from "@kairo/db";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";

/** Routes mounted under /github (raw-body webhook router + JSON event list). */
export const githubWebhookRouter = Router();
export const githubRouter = Router();

function serializeEvent(row: {
  id: string;
  eventType: string;
  action: string | null;
  repoOwner: string | null;
  repoName: string | null;
  number: number | null;
  title: string | null;
  url: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    eventType: row.eventType,
    action: row.action,
    repo: row.repoOwner && row.repoName ? `${row.repoOwner}/${row.repoName}` : null,
    number: row.number,
    title: row.title,
    url: row.url,
    createdAt: row.createdAt.toISOString(),
  };
}

// Webhook receiver — mounted with express.raw() BEFORE the global JSON parser.
githubWebhookRouter.post("/", async (req, res, next) => {
  try {
    if (!env.GITHUB_WEBHOOK_SECRET) {
      res.status(503).json({ error: "Webhook secret is not configured" });
      return;
    }

    const signatureHeader = req.get("x-hub-signature-256");
    if (!signatureHeader?.startsWith("sha256=")) {
      res.status(401).json({ error: "Missing webhook signature" });
      return;
    }
    const raw = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(String(req.body ?? ""));
    const expected = createHmac("sha256", env.GITHUB_WEBHOOK_SECRET)
      .update(raw)
      .digest("hex");
    const provided = signatureHeader.slice("sha256=".length);
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(provided, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }

    const eventType = req.get("x-github-event") ?? "ping";
    const deliveryId = req.get("x-github-delivery");
    if (!deliveryId) {
      res.status(400).json({ error: "Missing x-github-delivery header" });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      res.status(400).json({ error: "Webhook body is not JSON" });
      return;
    }

    if (eventType === "ping") {
      res.json({ ok: true, pong: true });
      return;
    }

    const body = payload as Record<string, any>;
    const installation = body.installation;
    const account = installation?.account ?? body.repository?.owner;
    const repo = body.repository;
    const subject =
      eventType === "issues"
        ? body.issue
        : eventType === "pull_request" ||
            eventType === "pull_request_review" ||
            eventType === "pull_request_review_comment"
          ? body.pull_request ?? body.comment
          : body.comment;

    let userId: string | null = null;
    if (typeof account?.id === "number") {
      const user = await prisma.user.findFirst({
        where: { githubId: String(account.id) },
        select: { id: true },
      });
      userId = user?.id ?? null;
    }

    const title = typeof subject?.title === "string" ? subject.title : null;
    const url = typeof subject?.html_url === "string" ? subject.html_url : null;

    await prisma.githubEvent.upsert({
      where: { deliveryId },
      create: {
        userId,
        deliveryId,
        eventType,
        action: typeof body.action === "string" ? body.action : null,
        installationId:
          typeof installation?.id === "number" ? String(installation.id) : null,
        repoOwner: typeof repo?.owner?.login === "string" ? repo.owner.login : null,
        repoName: typeof repo?.name === "string" ? repo.name : null,
        number: typeof (subject ?? body)?.number === "number" ? Number((subject ?? body).number) : null,
        title,
        url,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
      update: { action: typeof body.action === "string" ? body.action : null },
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Signed-event feed for the sidebar (sessions area lists runs; this lists GH).
githubRouter.get("/events", requireAuth, async (req, res, next) => {
  try {
    const rows = await prisma.githubEvent.findMany({
      where: { userId: req.auth!.user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    res.json({
      events: rows.map((row) => serializeEvent(row)),
    });
  } catch (err) {
    next(err);
  }
});

githubRouter.get("/", requireAuth, async (_req, res) => {
  res.json({ ok: true });
});
