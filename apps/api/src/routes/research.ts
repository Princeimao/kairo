import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { authenticate } from "../llm/proxy.js";
import {
  TavilyNotConfiguredError,
  tavilyExtract,
  tavilySearch,
} from "../lib/tavily.js";

/** Sandbox-facing (agent curls this with $KAIRO_LLM_TOKEN). */
export const researchRouter = Router();
/** User-facing (browser, session cookie) — same handlers, different auth. */
export const userResearchRouter = Router();

const searchBody = z
  .object({
    query: z.string().trim().min(2).max(400),
    maxResults: z.number().int().min(1).max(10).optional(),
    topic: z.enum(["general", "news", "finance"]).optional(),
  })
  .strict();

const extractBody = z
  .object({
    urls: z.array(z.string().trim().url().max(2_000)).min(1).max(5),
  })
  .strict();

function handleError(error: unknown, res: Response): void {
  if (error instanceof TavilyNotConfiguredError) {
    res.status(503).json({ error: error.message });
    return;
  }
  res.status(502).json({
    error: error instanceof Error ? error.message : String(error),
  });
}

async function handleSearch(req: Request, res: Response): Promise<void> {
  const body = searchBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: "query (2-400 chars) is required" });
    return;
  }
  try {
    res.json(await tavilySearch(body.data));
  } catch (error) {
    handleError(error, res);
  }
}

async function handleExtract(req: Request, res: Response): Promise<void> {
  const body = extractBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: "urls (1-5 http(s) urls) are required" });
    return;
  }
  const urls = body.data.urls.filter((raw) => {
    try {
      const url = new URL(raw);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  });
  if (urls.length === 0) {
    res.status(400).json({ error: "at least one http(s) url is required" });
    return;
  }
  try {
    res.json(await tavilyExtract(urls));
  } catch (error) {
    handleError(error, res);
  }
}

// ── /internal/research/* — same trust model as the LLM proxy/actions ──────
researchRouter.post("/search", async (req, res) => {
  const authed = await authenticate(req).catch(() => null);
  if (authed === null) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await handleSearch(req, res);
});

researchRouter.post("/extract", async (req, res) => {
  const authed = await authenticate(req).catch(() => null);
  if (authed === null) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await handleExtract(req, res);
});

// ── /research/* — the signed-in user (research popover in the console) ────
userResearchRouter.post("/search", requireAuth, handleSearch);
userResearchRouter.post("/extract", requireAuth, handleExtract);
