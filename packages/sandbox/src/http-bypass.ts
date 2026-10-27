import type { Readable } from "node:stream";
import { WritableStream } from "node:stream/web";
import { fetch as undiciFetch, type Dispatcher } from "undici";
import type { DockerClient } from "@docker/node-sdk";

interface HttpInternals {
  agent: Dispatcher;
  headers: Record<string, string>;
}

export async function putContainerArchiveRaw(
  client: DockerClient,
  containerId: string,
  path: string,
  tar: Readable,
  options: { copyUIDGID?: string; noOverwriteDirNonDir?: string } = {},
): Promise<void> {
  const internals = (client as unknown as { api: HttpInternals }).api;
  const params = new URLSearchParams({
    path,
    ...(options.copyUIDGID ? { copyUIDGID: options.copyUIDGID } : {}),
    ...(options.noOverwriteDirNonDir
      ? { noOverwriteDirNonDir: options.noOverwriteDirNonDir }
      : {}),
  });
  const chunks: Buffer[] = [];
  for await (const chunk of tar) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  const response = await undiciFetch(
    `http://docker/containers/${containerId}/archive?${params.toString()}`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/x-tar",
        ...internals.headers,
      },
      body: Buffer.concat(chunks),
      dispatcher: internals.agent,
    },
  );
  if (response.status >= 300) {
    const text = await response.text().catch(() => "");
    throw formatArchiveError(response.status, text, "put");
  }
  await response.body?.cancel().catch(() => undefined);
}

/**
 * Raw GET of a container path archive. The SDK's `containerArchive` cannot
 * distinguish a 404 from success (it pipes the error body into the caller's
 * stream), so we perform the request ourselves and classify by status.
 */
export async function getContainerArchiveRaw(
  client: DockerClient,
  containerId: string,
  path: string,
  maxBytes: number,
): Promise<{ buffer: Buffer; truncated: boolean }> {
  const internals = (client as unknown as { api: HttpInternals }).api;
  const params = new URLSearchParams({ path });
  const response = await undiciFetch(
    `http://docker/containers/${containerId}/archive?${params.toString()}`,
    {
      headers: {
        accept: "application/x-tar",
        ...internals.headers,
      },
      dispatcher: internals.agent,
    },
  );
  if (response.status >= 300) {
    if (response.body) {
      const text = await response.text().catch(() => "");
      if (response.status === 404) {
        throw new NotFoundSignal(text, formatArchiveError(response.status, text, "get"));
      }
      throw formatArchiveError(response.status, text, "get");
    }
    throw new Error(`getContainerArchive failed (${response.status})`);
  }
  if (!response.body) {
    return { buffer: Buffer.alloc(0), truncated: false };
  }
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  for await (const chunk of response.body) {
    if (total >= maxBytes) {
      truncated = true;
      break;
    }
    const buf = chunk instanceof Uint8Array ? Buffer.from(chunk) : Buffer.from(String(chunk));
    const remaining = maxBytes - total;
    if (buf.length > remaining) {
      chunks.push(buf.subarray(0, remaining));
      total += remaining;
      truncated = true;
      break;
    }
    chunks.push(buf);
    total += buf.length;
  }
  // Always drain the rest so the socket can be reused by the pool.
  if (truncated) {
    await response.body.pipeTo(
      new WritableStream({ write() {} }),
    ).catch(() => undefined);
  }
  return { buffer: Buffer.concat(chunks), truncated };
}

export class NotFoundSignal extends Error {
  constructor(
    readonly serverMessage: string,
    message: string,
  ) {
    super(message);
    this.name = "NotFoundSignal";
  }
}

function formatArchiveError(status: number, bodyText: string, kind: string): string {
  let message = bodyText;
  try {
    const parsed = JSON.parse(bodyText) as { message?: string };
    if (typeof parsed.message === "string") message = parsed.message;
  } catch {
    // keep raw text
  }
  return `${kind}ContainerArchive failed (${status}): ${message}`;
}
