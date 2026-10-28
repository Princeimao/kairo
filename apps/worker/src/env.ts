import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// apps/worker/.env first, then apps/api/.env as a fallback for shared keys
// (loadEnvFile never overrides already-set values).
try {
  process.loadEnvFile();
} catch {
  // no own .env — fall through to shared file / process env
}
const here = dirname(fileURLToPath(import.meta.url));
const sharedEnv = resolve(here, "..", "..", "api", ".env");
if (existsSync(sharedEnv)) {
  try {
    process.loadEnvFile(sharedEnv);
  } catch {
    // unreadable shared file — rely on what we already have
  }
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),
  SANDBOX_SECRET: z.string().min(16).default("kairo-dev-sandbox-secret"),
  // URL this host uses to reach the LLM proxy (same process as the API).
  LLM_PROXY_BASE_URL: z.string().url().default("http://host.docker.internal:4100"),
  // OpenCode model + the provider id the worker writes into opencode.json.
  OPENCODE_MODEL: z.string().default("nvidia/nemotron-3.5-super-vl:free"),
  OPENCODE_PROVIDER_ID: z.string().trim().min(1).default("kairo"),
  RUN_TIMEOUT_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  GITHUB_API_URL: z.string().url().default("https://api.github.com"),
  // Needed only for the host-side GitHub flow (decrypts GithubConnection).
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("[worker] Invalid environment configuration:");
  for (const [key, messages] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`  ${key}: ${messages?.join(", ")}`);
  }
  console.error("  See apps/worker/.env.example.");
  process.exit(1);
}

export const env = parsed.data;

export function encryptionKey(): Buffer | null {
  if (env.TOKEN_ENCRYPTION_KEY === undefined || env.TOKEN_ENCRYPTION_KEY === "") return null;
  try {
    const key = Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}
