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

/** 32-byte AES-256 key used for GithubConnection token encryption. */
export const encryptionKey = Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64");

export const sessionTtlMs = () => env.SESSION_TTL_HOURS * 60 * 60 * 1000;
export const oauthCookieTtlMs = () => 10 * 60 * 1000;
