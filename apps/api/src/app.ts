import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import { prisma } from "@kairo/db";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requireAuth } from "./middleware/auth.js";
import { authRateLimiter } from "./middleware/rate-limit.js";
import { authRouter } from "./routes/auth.js";
import { runRouter } from "./routes/runs.js";
import { sandboxRouter } from "./routes/sandbox.js";
import { githubRouter, githubWebhookRouter } from "./routes/github.js";
import { conversationRouter, sessionRouter } from "./routes/sessions.js";

export const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.WEB_URL,
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(morgan("dev"));

app.use(
  "/github/webhook",
  express.raw({ type: "*/*", limit: "10mb" }),
  githubWebhookRouter,
);
app.use(express.json());

// ── Routes ──────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/auth", authRateLimiter, authRouter);
app.use("/runs", runRouter);
app.use("/sessions", sessionRouter);
app.use("/conversations", conversationRouter);
app.use("/sandbox", sandboxRouter);
app.use("/github", githubRouter);

app.get("/protected", requireAuth, async (req, res, next) => {
  try {
    const auth = req.auth;
    if (!auth) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const connection = await prisma.githubConnection.findUnique({
      where: { userId: auth.user.id },
    });

    res.json({
      ok: true,
      message: "You reached a protected route.",
      userId: auth.user.id,
      username: auth.user.username,
      sessionExpiresAt: auth.session.expiresAt,
      scopes: connection?.scopes ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// ── Error handling (must be last) ───────────────────────────────────
app.use(errorHandler);
