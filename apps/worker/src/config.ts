import { DockerWorkspace } from "@kairo/sandbox";
import { env } from "./env.js";

const CONFIG_PATH = ".kairo/config/opencode.json";

const AGENTS_MD = `# Kairo user sandbox

- Everything you can use lives under /workspace. Work there.
- When a repository was cloned for a task it is at /workspace/repo.
- Prefer small, working changes; run commands to verify before summarizing.
- Finish with a short plain-text summary of what changed.
`;

export function openCodeConfigJson(): string {
  const modelId = env.OPENCODE_MODEL;
  const providerId = env.OPENCODE_PROVIDER_ID;
  return `${JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      model: modelId,
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
        webfetch: "deny",
        websearch: "deny",
        task: "deny",
        lsp: "deny",
        skill: "deny",
        question: "deny",
        doom_loop: "deny",
      },
      providers: {
        [providerId]: {
          npm: "@ai-sdk/openai-compatible",
          name: "OpenRouter",
          options: {
            baseURL: "https://openrouter.ai/api/v1",
            apiKey: "{env:OPENROUTER_API_KEY}",
          },
          models: {
            [modelId]: {
              name: modelId,
            },
          },
        },
      },
    },
    null,
    2,
  )}\n`;
}

/** Writes (or refreshes) the harness config + AGENTS.md inside the volume. */
export async function ensureWorkspaceConfig(
  ws: DockerWorkspace,
): Promise<void> {
  const desired = openCodeConfigJson();
  const current = await ws.readFile(CONFIG_PATH).catch(() => null);
  if (current === null || current.content !== desired) {
    await ws.writeFile(CONFIG_PATH, desired);
  }
  const agents = await ws.readFile("AGENTS.md").catch(() => null);
  if (agents === null) {
    await ws.writeFile("AGENTS.md", AGENTS_MD);
  }
}
