import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DockerWorkspace } from "@kairo/sandbox";
import {
  createRedis,
  runAskAnswerKey,
  runAskKey,
  runAskPendingKey,
} from "@kairo/run-queue";
import { prisma } from "@kairo/db";
import { authenticate } from "../llm/proxy.js";
import { GitHubApiError, githubJson, userAccessToken } from "../lib/github.js";

/**
 * Endpoints the sandbox agent calls with curl (bearer = KAIRO_LLM_TOKEN, the
 * same trust model as the LLM proxy — container running + active run):
 *
 *   POST /internal/actions/ask          ask the user a question, block until answered
 *   POST /internal/actions/github/push  create repo + push /workspace/repo (needs an approved ask)
 *
 * Approval lives in Redis: ask writes `run:{id}:ask:{askId}` + a pending marker
 * (the worker polls the marker and emits the `ask` SSE event), the UI answers
 * via POST /runs/:id/answers which writes the answer key, and this router's
 * long-poll returns it to the agent's curl.
 */

export const actionsRouter = Router();

const ASK_WAIT_MS = 15 * 60 * 1000;
const ASK_POLL_MS = 400;
const ASK_RUN_CHECK_EVERY = 25; // ≈10s
const RUN_TTL_S = 60 * 60 * 24;
const REPO_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;
const PUSH_TIMEOUT_MS = 300_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deny(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

/** Single-quote a value so it is always safe inside a shell command. */
function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function basic(token: string): string {
  return Buffer.from(`x-access-token:${token}`).toString("base64");
}

async function activeRunId(req: Request, res: Response): Promise<string | null> {
  const authed = await authenticate(req);
  if (authed === null) {
    deny(res, 401, "sandbox token, container, or active run not valid");
    return null;
  }
  return authed.runId;
}

/**
 * POST /internal/actions/ask {question, options?}
 * Blocks until POST /runs/:id/answers writes an answer (or timeout/run end).
 * Responds {askId, approved, note?}.
 */
actionsRouter.post("/ask", async (req, res) => {
  const runId = await activeRunId(req, res);
  if (runId === null) return;

  const body = z
    .object({
      question: z.string().trim().min(1).max(4_000),
      options: z.array(z.string().trim().min(1).max(200)).max(8).optional(),
    })
    .safeParse(req.body);
  if (!body.success) {
    deny(res, 400, "question (string, 1-4000 chars) is required; options is optional");
    return;
  }

  const redis = createRedis();
  let clientGone = false;
  res.on("close", () => {
    if (!res.writableEnded) clientGone = true;
  });

  try {
    const pending = await redis.get(runAskPendingKey(runId));
    if (pending !== null) {
      deny(res, 409, "another question is already waiting for an answer");
      return;
    }

    const askId = randomUUID();
    await redis.set(
      runAskKey(runId, askId),
      JSON.stringify({
        question: body.data.question,
        options: body.data.options,
        createdAt: new Date().toISOString(),
      }),
      "EX",
      RUN_TTL_S,
    );
    await redis.set(runAskPendingKey(runId), askId, "EX", RUN_TTL_S);
    console.log(
      `[actions] ask run=${runId} askId=${askId} q="${body.data.question.slice(0, 80)}"`,
    );

    const deadline = Date.now() + ASK_WAIT_MS;
    let ticks = 0;
    for (;;) {
      await sleep(ASK_POLL_MS);
      if (clientGone || res.destroyed) return;
      ticks += 1;

      const answer = await redis.get(runAskAnswerKey(runId, askId));
      if (answer !== null) {
        let approved = false;
        let note: string | undefined;
        try {
          const parsed = JSON.parse(answer) as { approved?: unknown; note?: unknown };
          approved = parsed.approved === true;
          note = typeof parsed.note === "string" && parsed.note !== "" ? parsed.note : undefined;
        } catch {
          approved = false;
        }
        await redis.del(runAskPendingKey(runId));
        res.json({ askId, approved, note });
        return;
      }

      if (Date.now() > deadline) {
        await redis.del(runAskPendingKey(runId), runAskKey(runId, askId));
        deny(res, 408, "timed out waiting for an answer");
        return;
      }

      if (ticks % ASK_RUN_CHECK_EVERY === 0) {
        const run = await prisma.agentRun.findUnique({
          where: { id: runId },
          select: { status: true },
        });
        if (
          run === null ||
          ["SUCCEEDED", "FAILED", "CANCELLED"].includes(run.status)
        ) {
          deny(res, 409, "the run ended before the question was answered");
          return;
        }
      }
    }
  } catch (error) {
    if (!res.headersSent) {
      deny(res, 500, error instanceof Error ? error.message : String(error));
    }
  } finally {
    redis.disconnect();
  }
});

/**
 * POST /internal/actions/github/push {askId, repoName, description?, private?}
 * Creates (or reuses) the user's repository, then commits + pushes
 * /workspace/repo host-side with their OAuth token. Requires an approved ask.
 */
actionsRouter.post("/github/push", async (req, res) => {
  const authed = await authenticate(req);
  if (authed === null) {
    deny(res, 401, "sandbox token, container, or active run not valid");
    return;
  }

  const body = z
    .object({
      askId: z.string().trim().min(1).max(64),
      repoName: z.string().regex(REPO_NAME_RE, "repoName must be 1-100 chars of letters, digits, . _ -"),
      description: z.string().trim().max(350).optional(),
      private: z.boolean().optional().default(true),
    })
    .safeParse(req.body);
  if (!body.success) {
    deny(res, 400, body.error.issues[0]?.message ?? "invalid body");
    return;
  }
  const { askId, repoName } = body.data;

  // The user must have approved THIS ask (proof for audit + safety).
  const redis = createRedis();
  try {
    const askRaw = await redis.get(runAskKey(authed.runId, askId));
    const answerRaw = await redis.get(runAskAnswerKey(authed.runId, askId));
    if (askRaw === null) {
      deny(res, 400, "unknown askId — ask the user for approval first via POST /internal/actions/ask");
      return;
    }
    if (answerRaw === null) {
      deny(res, 409, "the question has not been answered yet");
      return;
    }
    let approved = false;
    try {
      approved = (JSON.parse(answerRaw) as { approved?: unknown }).approved === true;
    } catch {
      approved = false;
    }
    if (!approved) {
      deny(res, 403, "the user denied this request — do not push");
      return;
    }
  } finally {
    redis.disconnect();
  }

  try {
    const token = await userAccessToken(authed.userId);
    if (token === null) {
      deny(res, 400, "GitHub is not connected for this user");
      return;
    }

    // Create the repository, or reuse it when the user already owns the name.
    let repo: { full_name: string; html_url: string };
    try {
      const created = await githubJson<{ full_name?: unknown; html_url?: unknown }>(
        token,
        "POST",
        "/user/repos",
        {
          name: repoName,
          description: body.data.description ?? "Published from Kairo",
          private: body.data.private,
        },
      );
      if (typeof created.full_name !== "string" || typeof created.html_url !== "string") {
        deny(res, 502, "GitHub created the repository but returned no full_name");
        return;
      }
      repo = { full_name: created.full_name, html_url: created.html_url };
    } catch (error) {
      if (!(error instanceof GitHubApiError) || error.status !== 422) throw error;
      const me = await githubJson<{ login?: unknown }>(token, "GET", "/user");
      if (typeof me.login !== "string") {
        deny(res, 502, "could not resolve your GitHub login");
        return;
      }
      try {
        const existing = await githubJson<{ owner?: { login?: unknown }; html_url?: unknown }>(
          token,
          "GET",
          `/repos/${me.login}/${repoName}`,
        );
        const owner = existing.owner?.login;
        if (owner !== me.login || typeof existing.html_url !== "string") {
          deny(res, 409, `repository ${me.login}/${repoName} exists but is not owned by you`);
          return;
        }
        repo = { full_name: `${me.login}/${repoName}`, html_url: existing.html_url };
      } catch {
        deny(res, 409, `repository ${me.login}/${repoName} could not be created or reused`);
        return;
      }
    }

    // Content lives at /workspace/repo inside the user's container.
    const ws = new DockerWorkspace(authed.userId);
    const status = await ws.status();
    if (!status.running) {
      deny(res, 400, "the workspace container is not running");
      return;
    }
    const dir = await ws.exec("test -d repo", { timeoutMs: 15_000 });
    if (dir.exitCode !== 0) {
      deny(res, 400, "no project at /workspace/repo — create or move your project there first, then retry");
      return;
    }
    const gitDir = await ws.exec("test -d repo/.git", { timeoutMs: 15_000 });
    if (gitDir.exitCode !== 0) {
      const init = await ws.exec("git init", { cwd: "repo", timeoutMs: 60_000 });
      if (init.exitCode !== 0) {
        deny(res, 500, `git init failed: ${init.stderr.trim().slice(0, 300)}`);
        return;
      }
      await ws.exec("git branch -M main", { cwd: "repo", timeoutMs: 15_000 });
    }

    const head = await ws.exec("git rev-parse --verify HEAD", {
      cwd: "repo",
      timeoutMs: 15_000,
    });
    const staged = await ws.exec("git add -A", { cwd: "repo", timeoutMs: 60_000 });
    if (staged.exitCode !== 0) {
      deny(res, 500, `git add failed: ${staged.stderr.trim().slice(0, 300)}`);
      return;
    }
    const commit = await ws.exec(
      `git -c user.name="Kairo" -c user.email="kairo@users.noreply.github.com" commit -m "Publish from Kairo"`,
      { cwd: "repo", timeoutMs: 60_000 },
    );
    if (commit.exitCode !== 0 && head.exitCode !== 0) {
      deny(res, 409, "nothing to publish: /workspace/repo has no commits and no file changes");
      return;
    }

    let branch = (await ws.exec("git rev-parse --abbrev-ref HEAD", {
      cwd: "repo",
      timeoutMs: 15_000,
    })).stdout.trim();
    if (branch === "" || branch === "HEAD") {
      await ws.exec("git branch -M main", { cwd: "repo", timeoutMs: 15_000 });
      branch = "main";
    }

    const remote = await ws.exec(
      `git remote remove origin 2>/dev/null; git remote add origin ${shq(`https://github.com/${repo.full_name}.git`)}`,
      { cwd: "repo", timeoutMs: 15_000 },
    );
    if (remote.exitCode !== 0) {
      deny(res, 500, `could not set the git remote: ${remote.stderr.trim().slice(0, 300)}`);
      return;
    }

    const push = await ws.exec(
      `git -c http.extraHeader="AUTHORIZATION: basic ${basic(token)}" push --set-upstream origin ${shq(branch)}`,
      { cwd: "repo", timeoutMs: PUSH_TIMEOUT_MS },
    );
    if (push.exitCode !== 0) {
      deny(res, 502, `push failed: ${push.stderr.trim().slice(0, 400)}`);
      return;
    }

    console.log(
      `[actions] pushed run=${authed.runId} repo=${repo.full_name} branch=${branch}`,
    );
    res.json({ ok: true, repoFullName: repo.full_name, url: repo.html_url, branch });
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 401) {
      deny(
        res,
        502,
        "GitHub rejected the saved token (expired or revoked) — reconnect GitHub in Kairo, then retry with the same askId",
      );
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (!res.headersSent) deny(res, 502, message);
  }
});
