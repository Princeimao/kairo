import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const schema = z.object({
  NEBIUS_API_KEY: z.string().min(1).optional(),
  NEBIUS_BASE_URL: z
    .url()
    .default("https://api.tokenfactory.nebius.com/v1"),
  AGENT_PLANNER_MODEL: z
    .string()
    .min(1)
    .default("nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"),
  AGENT_EXECUTOR_MODEL: z
    .string()
    .min(1)
    .default("nvidia/nemotron-3-super-120b-a12b"),
  AGENT_PROBE_MODELS: z
    .string()
    .min(1)
    .default(
      "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B,nvidia/nemotron-3-super-120b-a12b,nvidia/Nemotron-3_5-Lightning,nvidia/Nemotron-3-Ultra-550b-a55b",
    ),
  AGENT_TOOL_MODE: z.enum(["native", "json"]).default("native"),
  AGENT_MAX_STEPS: z.coerce.number().int().positive().default(25),
  AGENT_MAX_REPLANS: z.coerce.number().int().min(0).default(1),
  AGENT_TIME_BUDGET_MS: z.coerce.number().int().positive().default(600_000),
  AGENT_TOOL_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  AGENT_MAX_TOOL_OUTPUT_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(20_000),
  AGENT_HISTORY_TOKEN_BUDGET: z.coerce
    .number()
    .int()
    .positive()
    .default(60_000),
  AGENT_MAX_STUCK_REPEATS: z.coerce.number().int().min(1).default(2),
  AGENT_LLM_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
  AGENT_MAX_READ_BYTES: z.coerce.number().int().positive().default(1_048_576),
  AGENT_MAX_WRITE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(1_048_576),
});

export type AgentEnv = z.infer<typeof schema>;

let cached: AgentEnv | null = null;

function loadEnvFiles(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, ".env"),
    join(here, "..", ".env"),
    join(here, "..", "..", ".env"),
    join(here, "..", "..", "..", ".env"),
    join(process.cwd(), ".env"),
  ];
  for (const file of candidates) {
    const abs = resolve(file);
    if (!existsSync(abs)) continue;
    try {
      process.loadEnvFile(abs);
    } catch {
      // ignore malformed or unreadable env files
    }
  }
}

export function loadAgentEnv(): AgentEnv {
  if (cached) return cached;
  loadEnvFiles();
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid agent environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function requireApiKey(env: AgentEnv = loadAgentEnv()): string {
  const key = env.NEBIUS_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "NEBIUS_API_KEY is not set. Add it to packages/agent/.env, the repo root .env, or your shell environment (see .env.example).",
    );
  }
  return key;
}
