import { existsSync, readFileSync } from "node:fs";
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

// Same files, same order as the startup load — re-read on demand so edits to
// .env apply to the NEXT run without restarting the worker process.
const envFiles = [
  resolve(process.cwd(), ".env"),
  resolve(here, "..", ".env"),
  sharedEnv,
].filter((file, index, all) => all.indexOf(file) === index && existsSync(file));

function readEnvFileValue(file: string, key: string): string | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      line,
    );
    if (match === null || match[1] !== key) continue;
    let value = match[2].trim();
    if (value.startsWith("#")) continue;
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    } else {
      const comment = value.indexOf(" #");
      if (comment !== -1) value = value.slice(0, comment).trim();
    }
    if (value !== "") return value;
  }
  return null;
}

/** Fresh lookup: .env files (startup order) win over the process environment. */
export function freshEnvValue(key: string): string | null {
  for (const file of envFiles) {
    const value = readEnvFileValue(file, key);
    if (value !== null) return value;
  }
  const fromProcess = process.env[key];
  return fromProcess !== undefined && fromProcess !== "" ? fromProcess : null;
}

export interface ModelSettings {
  providerId: string;
  modelId: string;
}

/**
 * Current model/provider for the next run. Re-reads the .env files on every
 * call so changing OPENCODE_MODEL takes effect without restarting anything.
 * If OPENCODE_MODEL contains the provider prefix ("kairo/model" or
 * "openrouter/model"), it is stripped — model ids are stored bare.
 */
export function modelSettings(): ModelSettings {
  const providerId = (
    freshEnvValue("OPENCODE_PROVIDER_ID") ?? env.OPENCODE_PROVIDER_ID
  ).trim();
  let modelId = (freshEnvValue("OPENCODE_MODEL") ?? env.OPENCODE_MODEL).trim();
  const prefix = `${providerId}/`;
  if (modelId.startsWith(prefix)) modelId = modelId.slice(prefix.length);
  return { providerId, modelId };
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),
  SANDBOX_SECRET: z.string().min(16).default("kairo-dev-sandbox-secret"),
  LLM_PROXY_BASE_URL: z
    .string()
    .url()
    .default("http://host.docker.internal:4100"),
  // OpenCode model + the provider id the worker writes into opencode.json.
  // "kairo" = the host LLM proxy; never a builtin opencode provider id.
  OPENCODE_MODEL: z.string().default("nvidia/nemotron-3.5-super-vl:free"),
  OPENCODE_PROVIDER_ID: z.string().trim().min(1).default("kairo"),
  RUN_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 60 * 1000),
  GITHUB_API_URL: z.string().url().default("https://api.github.com"),
  // Needed only for the host-side GitHub flow (decrypts GithubConnection).
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("[worker] Invalid environment configuration:");
  for (const [key, messages] of Object.entries(
    parsed.error.flatten().fieldErrors,
  )) {
    console.error(`  ${key}: ${messages?.join(", ")}`);
  }
  console.error("  See apps/worker/.env.example.");
  process.exit(1);
}

export const env = parsed.data;

export function encryptionKey(): Buffer | null {
  if (env.TOKEN_ENCRYPTION_KEY === undefined || env.TOKEN_ENCRYPTION_KEY === "")
    return null;
  try {
    const key = Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}
