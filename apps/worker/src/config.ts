import { DockerWorkspace } from "@kairo/sandbox";
import { env, modelSettings, type ModelSettings } from "./env.js";

const CONFIG_PATH = ".kairo/config/opencode.json";

const AGENTS_MD = `# Kairo user sandbox

- Everything you can use lives under /workspace. Work there.
- When a repository was cloned for a task it is at /workspace/repo.
- Prefer small, working changes; run commands to verify before summarizing.
- Finish with a short plain-text summary of what changed.
`;

/**
 * opencode.json for the container. The provider always points at the host LLM
 * proxy (/internal/llm/v1) with the per-container token from the harness env —
 * provider keys never enter the sandbox. The top-level model must be
 * "<provider>/<modelId>"; the provider id must NOT collide with a builtin
 * opencode provider (use "kairo").
 *
 * NOTE: the config key is "provider" (singular). The plural "providers" is an
 * internal encoded map with a strict schema — entries there are rejected
 * silently and the model then resolves as "Model not found".
 */
export function openCodeConfigJson(settings: ModelSettings = modelSettings()): string {
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
        webfetch: "deny",
        websearch: "deny",
        task: "deny",
        lsp: "deny",
        skill: "deny",
        question: "deny",
        doom_loop: "deny",
      },
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
 * Writes (or refreshes) the harness config + AGENTS.md inside the volume.
 * Returns true when opencode.json changed — the caller must restart the
 * container so the running OpenCode server loads the new config (serve does
 * not hot-reload it).
 */
export async function ensureWorkspaceConfig(
  ws: DockerWorkspace,
  settings: ModelSettings = modelSettings(),
): Promise<{ changed: boolean }> {
  const desired = openCodeConfigJson(settings);
  const current = await ws.readFile(CONFIG_PATH).catch(() => null);
  const changed = current === null || current.content !== desired;
  if (changed) {
    await ws.writeFile(CONFIG_PATH, desired);
  }
  const agents = await ws.readFile("AGENTS.md").catch(() => null);
  if (agents === null) {
    await ws.writeFile("AGENTS.md", AGENTS_MD);
  }
  return { changed };
}
