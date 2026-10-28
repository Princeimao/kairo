import { DockerWorkspace } from "@kairo/sandbox";
import { env } from "./env.js";

const CONFIG_PATH = ".kairo/config/opencode.json";

const AGENTS_MD = `# Kairo user sandbox

- Everything you can use lives under /workspace. Work there.
- When a repository was cloned for a task it is at /workspace/repo.
- Prefer small, working changes; run commands to verify before summarizing.
- Finish with a short plain-text summary of what changed.
`;

/**
 * opencode.json for the container. Every key here was verified against the
 * published config schema (https://opencode.ai/config.json) for 1.19.x:
 * permission keys, share/update enums, and the providers.npm shape.
 * The model id may contain slashes ("org/name:tag"); provider id is separate,
 * so the top-level model is "<provider>/<modelId>".
 */
export function openCodeConfigJson(): string {
  const modelId = env.OPENCODE_MODEL;
  const providerId = env.OPENCODE_PROVIDER_ID;
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

/** Writes (or refreshes) the harness config + AGENTS.md inside the volume. */
export async function ensureWorkspaceConfig(ws: DockerWorkspace): Promise<void> {
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
