import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Load apps/api/.env (same semantics as `node --env-file`).
try {
  process.loadEnvFile();
} catch {
  // No .env file present — rely on the process environment.
}

const base64Key32 = z
  .string()
  .refine(
    (value) => {
      try {
        return Buffer.from(value, "base64").length === 32;
      } catch {
        return false;
      }
    },
    { message: "must be base64 encoding of exactly 32 bytes" },
  );

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(4000),
  // Public origin of the web app (CORS origin + post-login redirect target)
  WEB_URL: z.string().url().default("http://localhost:3000"),
  // Public base URL of this API, used to build the OAuth callback URL
  API_URL: z.string().url().default("http://localhost:4000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  GITHUB_CLIENT_ID: z.string().min(1, "GITHUB_CLIENT_ID is required"),
  GITHUB_CLIENT_SECRET: z.string().min(1, "GITHUB_CLIENT_SECRET is required"),
  // Slug of the Kairo GitHub App (https://github.com/apps/<slug>). Empty when
  // sign-in still runs with a classic OAuth App.
  GITHUB_APP_SLUG: z.string().trim().min(1).default("kairo"),
  // Space-separated scopes for classic OAuth Apps. Leave empty for GitHub
  // Apps — permissions come from the App settings and must NOT be set here.
  GITHUB_OAUTH_SCOPES: z
    .string()
    .regex(/^$|^[\w: -]+$/, "must be empty or space-separated scope words")
    .default(""),
  TOKEN_ENCRYPTION_KEY: base64Key32,
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 chars"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(720),
  SESSION_RENEW_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
  // GitHub is not an OpenID Connect provider, so the OAuth endpoints are
  // configured manually. Override only for GitHub Enterprise or local testing.
  GITHUB_AUTHORIZE_URL: z
    .string()
    .url()
    .default("https://github.com/login/oauth/authorize"),
  GITHUB_TOKEN_URL: z
    .string()
    .url()
    .default("https://github.com/login/oauth/access_token"),
  GITHUB_API_URL: z.string().url().default("https://api.github.com"),
  // GitHub App numeric id (Settings → Developer settings → GitHub Apps).
  GITHUB_APP_ID: z.coerce.number().int().positive().optional(),
  // Shared secret used to verify `x-hub-signature-256` on webhook deliveries.
  GITHUB_WEBHOOK_SECRET: z.string().min(1).optional(),

  // BullMQ + SSE relay.
  REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),
  // HMAC key: per-container OpenCode server password + LLM proxy token hashing.
  SANDBOX_SECRET: z.string().min(16).default("kairo-dev-sandbox-secret"),

  // LLM proxy (host-side, in this process).
  LLM_PROXY_PORT: z.coerce.number().int().positive().default(4100),
  LLM_PROXY_HOST: z.string().default("0.0.0.0"),
  // URL a sandbox container uses to reach the proxy (Docker Desktop).
  LLM_PROXY_BASE_URL: z.string().url().default("http://host.docker.internal:4100"),
  // OpenAI-compatible upstream for the proxy.
  NEBIUS_API_KEY: z.string().optional(),
  NEBIUS_BASE_URL: z.string().url().default("https://api.tokenfactory.nebius.com/v1"),
  // Comma-separated model ids the proxy will forward.
  LLM_MODEL_ALLOWLIST: z.string().default("nvidia/nemotron-3.5-super-vl:free"),
  // Default model OpenCode runs with.
  OPENCODE_MODEL: z.string().default("nvidia/nemotron-3.5-super-vl:free"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("[api] Invalid environment configuration:");
  for (const [key, messages] of Object.entries(
    parsed.error.flatten().fieldErrors,
  )) {
    console.error(`  ${key}: ${messages?.join(", ")}`);
  }
  console.error("  See apps/api/.env.example and docs/auth.md.");
  process.exit(1);
}

export const env = parsed.data;

if (!env.GITHUB_APP_ID || !env.GITHUB_WEBHOOK_SECRET) {
  console.warn(
    "[api] GITHUB_APP_ID and/or GITHUB_WEBHOOK_SECRET missing — the GitHub webhook receiver will reject deliveries until both are set.",
  );
}

/** 32-byte AES-256 key used for GithubConnection token encryption. */
export const encryptionKey = Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64");

export const sessionTtlMs = () => env.SESSION_TTL_HOURS * 60 * 60 * 1000;
export const oauthCookieTtlMs = () => 10 * 60 * 1000;

const API_ENV_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".env",
);

/**
 * Re-reads apps/api/.env on demand so edits (model allowlist, OPENCODE_MODEL)
 * take effect without restarting the API process. Falls back to the process
 * environment for keys not set in the file.
 */
export function freshEnvValue(key: string): string | null {
  if (existsSync(API_ENV_FILE)) {
    let text: string;
    try {
      text = readFileSync(API_ENV_FILE, "utf8");
    } catch {
      text = "";
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
  }
  const fromProcess = process.env[key];
  return fromProcess !== undefined && fromProcess !== "" ? fromProcess : null;
}
