import { prisma } from "@kairo/db";
import { DockerWorkspace } from "@kairo/sandbox";
import { env, modelSettings, type ModelSettings } from "./env.js";

const CONFIG_PATH = ".kairo/config/opencode.json";
const SKILLS_DIR = ".kairo/skills";
const SKILL_DIR_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const AGENTS_MD = `# Kairo user sandbox

## Workspace
- Everything you can use lives under /workspace. Work there.
- When a repository was cloned for a task it is at /workspace/repo — do all work inside that directory.
- \`.kairo/\` is harness configuration — never modify it.

## Doing the work
- Read the code around your change first and match its style.
- Prefer small, working changes; verify with real commands (the project's own build/test when present) before claiming it works.
- **Plan first:** for any non-trivial task, write a todo list with todowrite and keep it updated with todoread as you go — work through it to the end; do not stop at half-finished work.
- **Sub-agents:** independent chunks of work can be delegated to sub-agents with the task tool (e.g. parallel research + implementation); always review what they return.
- \`git push\` is blocked here. Publishing to GitHub and asking the user anything both go through the \`github-publish\` skill — load it with the skill tool and follow it (curl-based, auth token in $KAIRO_LLM_TOKEN).
- Do NOT call the built-in question tool — it is not wired up in this harness; user questions go through the ask flow in the github-publish skill.

## Research
- For anything current (library versions, API behaviour, unfamiliar docs, facts you are unsure of), use the \`research\` skill — Tavily search + page extraction through host endpoints. Prefer it over guessing, and cite the urls you actually read. The built-in webfetch tool is fine for a url you already know.

## Skills
- Beside the built-ins, the user may add their own skills to /workspace/.kairo/skills — when a task looks related to one, load it with the skill tool and follow it.

## Finishing
- End with a short plain-text summary of what changed and how you verified it.
`;

const SKILLS: Record<string, string> = {
  "github-publish/SKILL.md": `---
name: github-publish
description: Use when the user asks to publish, push, or create a GitHub repository from this workspace, or when you need the user's approval or an answer before an irreversible action. Covers the blocking ask endpoint and the push endpoint.
---

# Talking to the user and publishing to GitHub

Kairo exposes two internal endpoints for this sandbox. Call them with curl; the
API authenticates via the container token in $KAIRO_LLM_TOKEN, and the host is
reachable as http://host.docker.internal:4000.

## 1. Ask the user (always first)

\`\`\`sh
curl -sS -m 905 -X POST http://host.docker.internal:4000/internal/actions/ask \\
  -H "authorization: Bearer $KAIRO_LLM_TOKEN" \\
  -H "content-type: application/json" \\
  -d '{"question":"Publish this project to GitHub as \\"my-app\\" (private)?","options":["yes","no"]}'
\`\`\`

- \`-m 905\` lets the call block up to 15 minutes while the user answers.
- Response: \`{"askId":"...","approved":true,"note":"..."}\` — keep the askId for step 3.
- \`approved:false\` means declined: do not push, tell the user, stop.
- \`note\` carries the user's own words (a different repo name, extra requirements, "no").
  When a note exists, follow the note; re-ask if their reply changes the plan.

## 2. Prepare the project at /workspace/repo

- The project MUST live at /workspace/repo (create it / move your files there).
- Add a proper .gitignore FIRST (node_modules, dist, build output, .env, __pycache__, ...)
  so dependencies and secrets are never published.
- Leave committing to the endpoint: it runs \`git add -A\` + a commit + push for you,
  and initialises the repository when there is none yet.

## 3. Push

\`\`\`sh
curl -sS -m 330 -X POST http://host.docker.internal:4000/internal/actions/github/push \\
  -H "authorization: Bearer $KAIRO_LLM_TOKEN" \\
  -H "content-type: application/json" \\
  -d '{"askId":"ASK_ID_FROM_STEP_1","repoName":"my-app","description":"What this project is","private":true}'
\`\`\`

- The askId must come from an APPROVED ask of this run — anything else is refused (400/409/403).
- Response: \`{"ok":true,"repoFullName":"owner/my-app","url":"https://github.com/owner/my-app","branch":"main"}\` — report the url to the user.
- 409 "already exists"/"not owned": choose a different repoName, ask the user again (a new ask → new askId), then push.
- Other errors: fix exactly what the message says (e.g. missing /workspace/repo) and retry with the SAME askId.

## Existing repositories (clone → work → PR)

Different flow: the user attaches the repository before starting the run; it is
cloned to /workspace/repo and Kairo opens the pull request automatically when
the run succeeds (forking first if you have no push access). In that case just
make the file changes — do not commit, do not push, do not call these endpoints.
`,
  "software-engineer/SKILL.md": `---
name: software-engineer
description: Use when implementing, fixing, debugging, or refactoring code — plan-first workflow, matching the project's existing conventions, and verifying changes with real commands before summarizing.
---

# Engineering workflow

1. **Understand first.** Read the files around the change (entry points, neighbours, existing tests).
   Match the existing style, libraries and naming. No drive-by refactors.
2. **Plan small.** The smallest complete change that solves the task; leave unrelated files untouched.
3. **Implement.** Prefer editing existing files over creating new ones; comment only the non-obvious "why".
4. **Verify before claiming.** Run the project's own checks when they exist (build / test / lint scripts).
   Otherwise exercise the changed path with a real command. If verification fails, fix and re-run —
   never summarize unverified work.
5. **Summarize.** Short plain text: what changed, which commands verified it, anything left undone.

## Boundaries

- \`git push\` is blocked in this sandbox. To publish, or to ask the user anything, load the
  \`github-publish\` skill and follow it.
- Never print, log or commit secrets (.env files, tokens); .gitignore them first.
`,
  "research/SKILL.md": `---
name: research
description: Use when you need current information from the web — searching, reading online documentation, checking library/API behaviour, or verifying facts you are unsure of. Tavily-backed search + page extraction through host endpoints.
---

# Researching the web

Two host-side endpoints for this sandbox (auth: $KAIRO_LLM_TOKEN,
host: http://host.docker.internal:4000).

## Search

\`\`\`sh
curl -sS -m 45 -X POST http://host.docker.internal:4000/internal/research/search \\
  -H "authorization: Bearer $KAIRO_LLM_TOKEN" \\
  -H "content-type: application/json" \\
  -d '{"query":"how to configure X in Y","maxResults":5}'
\`\`\`

→ \`{"query":"...","results":[{"title":"...","url":"...","content":"...","score":0.9}]}\`
   (optional \`"topic"\`: general | news | finance).

## Read a page / docs

\`\`\`sh
curl -sS -m 60 -X POST http://host.docker.internal:4000/internal/research/extract \\
  -H "authorization: Bearer $KAIRO_LLM_TOKEN" \\
  -H "content-type: application/json" \\
  -d '{"urls":["https://example.com/docs/page"]}'
\`\`\`

→ \`{"results":[{"url":"...","content":"<page text>"}],"failed":[]}\` — max 5 urls per call.

## Rules

- Search first, extract the most promising 1-3 pages, then answer from what you read.
- Cite the urls you actually used — never invent sources.
- HTTP 503 = research is not configured on the host: fall back to the webfetch tool.
- Quote sparingly; extract caps pages at ~40k chars each.
`,
};

export function openCodeConfigJson(
  settings: ModelSettings = modelSettings(),
): string {
  const { modelId, providerId } = settings;
  return `${JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      model: `${providerId}/${modelId}`,
      share: "disabled",
      update: "disable",
      autoupdate: false,
      permission: {
        read: "allow",
        edit: "allow",
        glob: "allow",
        grep: "allow",
        list: "allow",
        bash: {
          "*": "allow",
          "git push *": "deny",
          "rm -rf / *": "deny",
        },
        external_directory: "allow",
        todowrite: "allow",
        todoread: "allow",
        webfetch: "allow",
        websearch: "allow",
        task: "allow",
        lsp: "allow",
        skill: "allow",
        question: "allow",
        doom_loop: "allow",
      },
      skills: ["/workspace/.kairo/skills"],
      provider: {
        [providerId]: {
          npm: "@ai-sdk/openai-compatible",
          name: "Kairo LLM proxy",
          options: {
            baseURL: `${env.LLM_PROXY_BASE_URL}/internal/llm/v1`,
            apiKey: "{env:KAIRO_LLM_TOKEN}",
          },
          models: {
            [modelId]: { name: modelId },
          },
        },
      },
    },
    null,
    2,
  )}\n`;
}

/**
 * Writes (or refreshes) the harness config, built-in + user skills and
 * AGENTS.md inside the volume; prunes skill directories that were deleted.
 * Returns true when something the running OpenCode server must reload changed
 * (opencode.json or the skill files) — the caller restarts the container
 * because `opencode serve` does not hot-reload them. AGENTS.md is plain
 * instructions read per session, so its rewrite does not force a restart.
 */
export async function ensureWorkspaceConfig(
  ws: DockerWorkspace,
  settings: ModelSettings = modelSettings(),
  userId?: string,
): Promise<{ changed: boolean }> {
  const desired = openCodeConfigJson(settings);
  const current = await ws.readFile(CONFIG_PATH).catch(() => null);
  let changed = current === null || current.content !== desired;
  if (changed) {
    await ws.writeFile(CONFIG_PATH, desired);
  }

  const skillFiles = new Map<string, string>(Object.entries(SKILLS));
  if (userId !== undefined) {
    try {
      const userSkills = await prisma.userSkill.findMany({
        where: { userId },
        orderBy: { name: "asc" },
      });
      for (const skill of userSkills) {
        if (!SKILL_DIR_NAME_RE.test(skill.name)) continue;
        if (skillFiles.has(`${skill.name}/SKILL.md`)) continue; // reserved
        skillFiles.set(`${skill.name}/SKILL.md`, skill.content);
      }
    } catch (error) {
      console.warn(
        `[worker] user skills unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const [relative, content] of skillFiles) {
    const path = `${SKILLS_DIR}/${relative}`;
    const existing = await ws.readFile(path).catch(() => null);
    if (existing === null || existing.content !== content) {
      await ws.writeFile(path, content);
      changed = true;
    }
  }

  // Remove skill directories that are no longer desired (built-in removed in a
  // code update, or the user deleted one of their skills).
  const listed = await ws
    .exec(`ls -1 ${SKILLS_DIR} 2>/dev/null || true`, { timeoutMs: 15_000 })
    .catch(() => null);
  const wanted = new Set(
    [...skillFiles.keys()].map((relative) => relative.split("/")[0]),
  );
  for (const line of listed?.stdout.split(/\r?\n/) ?? []) {
    const name = line.trim();
    if (name === "" || !SKILL_DIR_NAME_RE.test(name) || wanted.has(name)) {
      continue;
    }
    const removed = await ws
      .exec(`rm -rf -- ${JSON.stringify(`${SKILLS_DIR}/${name}`)}`, {
        timeoutMs: 15_000,
      })
      .catch(() => null);
    if (removed?.exitCode === 0) {
      console.log(`[worker] pruned stale skill dir: ${name}`);
      changed = true;
    }
  }

  const agents = await ws.readFile("AGENTS.md").catch(() => null);
  if (agents === null || agents.content !== AGENTS_MD) {
    await ws.writeFile("AGENTS.md", AGENTS_MD);
  }

  return { changed };
}
