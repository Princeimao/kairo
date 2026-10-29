import { createDecipheriv } from "node:crypto";
import { prisma } from "@kairo/db";
import { DockerWorkspace } from "@kairo/sandbox";
import { encryptionKey, env } from "./env.js";

/** Same stored format as apps/api/src/lib/crypto.ts (v1.aes-256-gcm). */
function decryptSecret(payload: string, key: Buffer): string {
  const [version, iv, authTag, ciphertext] = payload.split(".");
  if (version !== "v1" || !iv || !authTag || !ciphertext || payload.split(".").length !== 4) {
    throw new Error("Unrecognized encrypted payload format");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

async function userToken(userId: string): Promise<string | null> {
  const key = encryptionKey();
  if (key === null) return null;
  const connection = await prisma.githubConnection.findUnique({ where: { userId } });
  if (connection === null) return null;
  try {
    return decryptSecret(connection.accessTokenEncrypted, key);
  } catch {
    return null;
  }
}

function basic(token: string): string {
  return Buffer.from(`x-access-token:${token}`).toString("base64");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function gh(
  token: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${env.GITHUB_API_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "kairo-worker",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof json.message === "string" ? json.message : `HTTP ${response.status}`;
    throw new Error(`GitHub ${method} ${path} failed: ${message}`);
  }
  return json;
}

export class GithubFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GithubFlowError";
  }
}

/** Clone-before: fresh clone of the task repo into /workspace/repo. */
export async function githubPrepare(ws: DockerWorkspace, repoFullName: string, userId: string): Promise<void> {
  const token = await userToken(userId);
  if (token === null) {
    throw new GithubFlowError("no decryptable GitHub connection for this user");
  }
  const auth = basic(token);
  await ws.exec("rm -rf repo", { timeoutMs: 60_000 });
  const clone = await ws.exec(
    `git -c http.extraHeader="AUTHORIZATION: basic ${auth}" clone --depth 50 https://github.com/${repoFullName}.git repo`,
    { timeoutMs: 300_000 },
  );
  if (clone.exitCode !== 0) {
    throw new GithubFlowError(`clone failed: ${clone.stderr.trim().slice(0, 300)}`);
  }
}

/**
 * Bundle-and-push after the run + PR creation with OpenCode's final summary
 * as the body. Returns the PR URL. When the user cannot push to the base
 * repository, the branch goes to their fork and the PR is opened cross-repo.
 */
export async function githubFinish(
  ws: DockerWorkspace,
  run: { id: string; userId: string; repoFullName: string; prompt: string },
  summary: string,
): Promise<string> {
  const token = await userToken(run.userId);
  if (token === null) {
    throw new GithubFlowError("no decryptable GitHub connection for this user");
  }
  const auth = basic(token);
  const branch = `kairo/${run.id}`;

  const repository = await gh(token, "GET", `/repos/${run.repoFullName}`);
  const base =
    typeof repository.default_branch === "string" ? repository.default_branch : "main";
  const canPush =
    (repository.permissions as { push?: unknown } | undefined)?.push === true;

  // Read-only access → fork first, push there, open the PR across repos.
  let pushTarget = "origin";
  let head = branch;
  if (!canPush) {
    const fork = await gh(token, "POST", `/repos/${run.repoFullName}/forks`, {});
    const forkFullName = typeof fork.full_name === "string" ? fork.full_name : null;
    if (forkFullName === null) {
      throw new GithubFlowError("fork request returned no full_name");
    }
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        await gh(token, "GET", `/repos/${forkFullName}`);
        break;
      } catch (error) {
        if (attempt === 29) {
          throw new GithubFlowError(
            `fork ${forkFullName} never became ready: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        await sleep(1_000);
      }
    }
    pushTarget = `https://github.com/${forkFullName}.git`;
    head = `${forkFullName.split("/")[0]}:${branch}`;
  }

  const commitMessage = `Kairo run ${run.id}`;
  const commands = [
    `git checkout -b ${branch}`,
    "git add -A",
    `git commit -m ${JSON.stringify(commitMessage)} -m ${JSON.stringify(summary.slice(0, 5_000))} || echo "nothing to commit"`,
    `git -c http.extraHeader="AUTHORIZATION: basic ${auth}" push --set-upstream ${pushTarget} ${branch}`,
  ];
  for (const command of commands) {
    const result = await ws.exec(command, { cwd: "repo", timeoutMs: 120_000 });
    if (result.exitCode !== 0) {
      const isNothing = command.includes("nothing to commit");
      if (isNothing) {
        throw new GithubFlowError("no file changes to open a PR with");
      }
      throw new GithubFlowError(`git step failed (${command.split(" ")[0]}): ${result.stderr.trim().slice(0, 300)}`);
    }
  }

  const pull = await gh(token, "POST", `/repos/${run.repoFullName}/pulls`, {
    title: `Kairo: ${run.prompt.replace(/\s+/g, " ").trim().slice(0, 60)}`,
    head,
    base,
    body: summary.slice(0, 60_000) || "Automated change by Kairo.",
  });
  const htmlUrl = pull.html_url;
  if (typeof htmlUrl !== "string" || htmlUrl === "") {
    throw new GithubFlowError("pull request created but no html_url returned");
  }
  return htmlUrl;
}
