import { Router, type Request } from "express";
import { prisma } from "@kairo/db";
import { DockerWorkspace } from "@kairo/sandbox";
import { AppError } from "../middleware/error-handler.js";
import { requireAuth } from "../middleware/auth.js";

export const sandboxRouter = Router();

function authenticatedUser(req: Request): string {
  const id = req.auth?.user.id;
  if (!id) throw new AppError(401, "Authentication required");
  return id;
}

sandboxRouter.get(
  "/sandbox",
  requireAuth,
  async (req, res, next) => {
    try {
      const userId = authenticatedUser(req);
      const workspace = new DockerWorkspace(userId);
      const status = await workspace.status();
      const record = await prisma.sandbox
        .findUnique({ where: { userId } })
        .catch(() => null);
      res.json({
        running: status.running,
        image: status.image,
        volumeName: status.volumeName,
        containerName: status.containerName,
        lastActiveAt: record?.lastActiveAt.toISOString() ?? null,
      });
    } catch (err) {
      next(err);
    }
  },
);

sandboxRouter.post(
  "/sandbox/start",
  requireAuth,
  async (req, res, next) => {
    try {
      const userId = authenticatedUser(req);
      const workspace = new DockerWorkspace(userId);
      const running = await workspace.ensureRunning();
      await prisma.sandbox
        .upsert({
          where: { userId },
          create: {
            userId,
            image: running.image,
            volumeName: running.volumeName,
            containerName: running.containerName,
          },
          update: { lastActiveAt: new Date(), image: running.image },
        })
        .catch(() => undefined);
      res.status(202).json({
        ok: true,
        running: true,
        image: running.image,
        volumeName: running.volumeName,
        containerName: running.containerName,
      });
    } catch (err) {
      next(err);
    }
  },
);

sandboxRouter.post(
  "/sandbox/stop",
  requireAuth,
  async (req, res, next) => {
    try {
      const workspace = new DockerWorkspace(authenticatedUser(req));
      await workspace.stop();
      res.json({ ok: true, running: false });
    } catch (err) {
      next(err);
    }
  },
);
