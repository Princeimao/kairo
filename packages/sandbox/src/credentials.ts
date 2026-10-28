import { createHash, createHmac } from "node:crypto";

/** Stamped on every harness container; mismatch forces a recreate. */
export const HARNESS_LABEL = "kairo.harness";
export const HARNESS_LABEL_VALUE = "opencode-v1";

function sandboxSecret(): string {
  const raw = process.env.SANDBOX_SECRET?.trim();
  return raw !== undefined && raw.length >= 16
    ? raw
    : "kairo-dev-sandbox-secret";
}

/**
 * Basic-auth password for the container's `opencode serve`
 * (OPENCODE_SERVER_PASSWORD). Derived, never stored: the orchestrator
 * recomputes it from SANDBOX_SECRET + the stable container name.
 */
export function serverPasswordFor(containerName: string): string {
  return createHmac("sha256", sandboxSecret())
    .update(`opencode-server:${containerName}`)
    .digest("hex");
}

/**
 * Per-container token for the LLM proxy (KAIRO_LLM_TOKEN env). Derived the
 * same way so the worker never has to keep the plaintext — only
 * `llmTokenHash(token)` lands in the Sandbox row and the proxy verifies by
 * hashing whatever the container presents.
 */
export function llmTokenFor(containerName: string): string {
  return createHmac("sha256", sandboxSecret())
    .update(`llm-token:${containerName}`)
    .digest("hex");
}

export function llmTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
