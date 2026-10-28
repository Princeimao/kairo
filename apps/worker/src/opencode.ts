import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import { serverPasswordFor } from "@kairo/sandbox";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function containerBaseUrl(hostPort: number): string {
  return `http://127.0.0.1:${hostPort}`;
}

function authHeader(containerName: string): string {
  const password = serverPasswordFor(containerName);
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
}

export function createClient(baseUrl: string, containerName: string): OpencodeClient {
  return createOpencodeClient({
    baseUrl,
    headers: { authorization: authHeader(containerName) },
  });
}

/** Polls /global/health (basic auth) until healthy or the deadline passes. */
export async function waitForHealth(
  baseUrl: string,
  containerName: string,
  deadlineMs: number,
): Promise<void> {
  const authorization = authHeader(containerName);
  const deadline = Date.now() + deadlineMs;
  let last = "no response";
  for (;;) {
    try {
      const response = await fetch(`${baseUrl}/global/health`, {
        headers: { authorization },
      });
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() >= deadline) {
      throw new Error(`opencode server not healthy after ${deadlineMs}ms (${last})`);
    }
    await sleep(400);
  }
}
