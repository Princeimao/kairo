import { PassThrough } from "node:stream";
import type { Readable } from "node:stream";
import { WritableStream } from "node:stream/web";
import { pack, extract } from "tar-stream";
import { WorkspaceError } from "@kairo/agent";

const SANDBOX_UID = 1000;
const SANDBOX_GID = 1000;
const DEFAULT_FILE_MODE = 0o644;
const DEFAULT_DIR_MODE = 0o755;

/*
 * Builds an in-memory tar for `putContainerArchive`. Docker extracts entries
 * into the query `path` directory; we upload at /workspace with the full
 * relative path as the entry name and force parent-dir entries so Docker can
 * materialize intermediate directories.
 *
 * The caller passes `copyUIDGID: true`, which makes the daemon write the
 * file with the entry's uid/gid — here the sandbox user — so agent-owned
 * files stay writable without a chown round trip.
 */
export function packFileTar(relPath: string, file: Buffer): Promise<Buffer> {
  if (typeof relPath !== "string") throw new WorkspaceError("relPath must be a string", "INVALID_PATH");
  const normalized = relPath
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");
  if (normalized === "") throw new WorkspaceError("relPath must name a file", "INVALID_PATH");
  const chunks: Buffer[] = [];
  const tarStream = pack();
  return new Promise<Buffer>((resolvePack, rejectPack) => {
    tarStream.on("error", rejectPack);
    tarStream.on("data", (chunk: unknown) => {
      if (Buffer.isBuffer(chunk)) chunks.push(chunk);
    });
    tarStream.on("end", () => resolvePack(Buffer.concat(chunks)));
    const segments = normalized.split("/");
    let prefix = "";
    for (let i = 0; i < segments.length - 1; i += 1) {
      prefix = prefix === "" ? segments[i]! : `${prefix}/${segments[i]}`;
      tarStream.entry(
        {
          name: prefix,
          type: "directory",
          mode: DEFAULT_DIR_MODE,
          uid: SANDBOX_UID,
          gid: SANDBOX_GID,
          mtime: new Date(),
        },
        (error?: Error | null) => {
          if (error) rejectPack(error);
        },
      );
    }
    tarStream.entry(
      {
        name: normalized,
        type: "file",
        size: file.length,
        mode: DEFAULT_FILE_MODE,
        uid: SANDBOX_UID,
        gid: SANDBOX_GID,
        mtime: new Date(),
      },
      file,
      (error?: Error | null) => {
        if (error) {
          rejectPack(error);
        } else {
          tarStream.finalize();
        }
      },
    );
  });
}

/*
 * Reads the web WritableStream used by `containerArchive` into a capped
 * Buffer. The SDK resolves its own promise after `body.pipeTo(out)`, i.e.
 * once every byte has been written and the body is drained — so the caller
 * awaits `take()` right after awaiting the SDK call.
 */
export function bufferWritable(maxBytes: number): {
  stream: WritableStream;
  take: () => Promise<Buffer>;
} {
  const chunks: Buffer[] = [];
  const total = { bytes: 0 };
  const stream = new WritableStream<Uint8Array>({
    write(chunk) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = maxBytes - total.bytes;
      if (remaining <= 0) return;
      if (buf.length > remaining) {
        chunks.push(buf.subarray(0, remaining));
        total.bytes += remaining;
        return;
      }
      chunks.push(buf);
      total.bytes += buf.length;
    },
  });
  const take = (): Promise<Buffer> => Promise.resolve(Buffer.concat(chunks));
  return { stream, take };
}

/**
 * Reads the first regular-file entry out of a single-file tar (what
 * `containerArchive(path=...)` emits), capped at `maxBytes`. The remainder
 * of the archive is drained so the extract stream reaches completion.
 */
export function unpackFirstFileTar(tarBuffer: Buffer, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let captured = 0;
  const tarStream = extract();
  const done = new Promise<Buffer>((resolve, reject) => {
    tarStream.on("error", (error: Error) => {
      reject(error instanceof WorkspaceError ? error : new WorkspaceError(error.message));
    });
    tarStream.on("entry", (header, entryStream, next: () => void) => {
      if (chunks.length > 0) {
        // Already have our file; keep everything else flowing to /dev/null.
        entryStream.resume();
        next();
        return;
      }
      if (header.type !== "file") {
        entryStream.resume();
        next();
        return;
      }
      entryStream.on("data", (chunk: unknown) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        const remaining = maxBytes - captured;
        if (remaining <= 0) return;
        if (buf.length > remaining) {
          chunks.push(buf.subarray(0, remaining));
          captured += remaining;
          return;
        }
        chunks.push(buf);
        captured += buf.length;
      });
      entryStream.on("end", next);
      entryStream.on("error", (error: Error) => {
        reject(new WorkspaceError(error.message));
      });
    });
    tarStream.on("finish", () => resolve(Buffer.concat(chunks)));
  });
  PassThrough.from([tarBuffer]).pipe(tarStream);
  return done;
}

/**
 * Node-Readable from a Buffer, for `putContainerArchive(tar:)`.
 */
export function bufferToNodeReadable(buffer: Buffer): Readable {
  const source = new PassThrough();
  source.end(buffer);
  return source;
}
