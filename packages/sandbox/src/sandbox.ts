import { Writable } from "node:stream";
import type { WritableStream } from "node:stream/web";
import {
  DockerClient,
  NotFoundError,
  type ContainerInspectResponse,
  type DockerClient as DockerClientInstance,
} from "@docker/node-sdk";
import {
  WorkspaceError,
  type ExecOptions,
  type ExecResult,
  type ListOptions,
  type ListResult,
  type ReadResult,
  type SearchHit,
  type SearchResult,
  type Workspace,
  type WriteResult,
} from "@kairo/agent";
import { bufferToNodeReadable, bufferWritable, packFileTar, unpackFirstFileTar } from "./archive.js";
import {
  containerNameFor,
  loadSandboxConfig,
  SANDBOX_UID_GID,
  volumeNameFor,
} from "./config.js";

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
]);

const INSPECT_POLL_MS = 50;
const EXIT_POLL_DEADLINE_MS = 5_000;
const WAIT_EXITED_DEADLINE_MS = 30_000;
const SEARCH_TIMEOUT_MS = 15_000;
const LIST_TIMEOUT_MS = 30_000;
const LIST_MAX_OUTPUT_BYTES = 1_000_000;
const SEARCH_MAX_OUTPUT_BYTES = 200_000;
const WORKSPACE_ROOT = "/workspace";

type ClientDeps = {
  client: DockerClientInstance;
  config: ReturnType<typeof loadSandboxConfig>;
};

let cachedClient: Promise<ClientDeps> | undefined;

/**
 * The SDK's `getJSON` throws the NotFoundError *class* (not an instance)
 * on 404 responses, so identity comparison is part of the check.
 */
function isNotFound(error: unknown): boolean {
  if (error === NotFoundError) return true; // the class itself, SDK quirk
  if (error instanceof NotFoundError) return true;
  return /404|no such/i.test(String((error as Error)?.message ?? ""));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getClient(): Promise<ClientDeps> {
  if (cachedClient === undefined) {
    cachedClient = (async () => {
      const config = loadSandboxConfig();
      // The official SDK's npipe handling is raw net.createConnection, so
      // the default is set explicitly (fromDockerConfig builds a
      // four-slash path Node cannot open on Windows).
      const client = await DockerClient.fromDockerHost(
        config.dockerHost ?? "npipe://./pipe/docker_engine",
      );
      return { client, config };
    })().catch((error: unknown) => {
      cachedClient = undefined;
      throw error;
    });
  }
  return cachedClient;
}

/** Node Writable that collects up to maxBytes, then drops the rest. */
class CaptureWritable extends Writable {
  private readonly chunks: Buffer[] = [];
  private captured = 0;
  truncated = false;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    const remaining = this.maxBytes - this.captured;
    if (remaining <= 0) {
      this.truncated = true;
      callback();
      return;
    }
    if (chunk.length > remaining) {
      this.chunks.push(chunk.subarray(0, remaining));
      this.captured += remaining;
      this.truncated = true;
      callback();
      return;
    }
    this.chunks.push(chunk);
    this.captured += chunk.length;
    callback();
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

export interface RunningSandbox {
  volumeName: string;
  containerName: string;
  image: string;
  reused: boolean;
}

export interface SandboxStatus {
  running: boolean;
  containerName: string;
  volumeName: string;
  image: string;
}

/**
 * The agent's computer, inside a per-user Docker container.
 *
 * - volume `kairo-ws-<userId>` mounted at /workspace: the agent's files
 * - image built by `npm run sandbox:build` (node+git+rg+python+toolchain)
 * - non-root user 1000, caps dropped, read-only rootfs, memory/pids capped
 */
export class DockerWorkspace implements Workspace {
  readonly rootLabel = "sandbox";
  readonly userId: string;
  private readonly containerName: string;
  private readonly volumeName: string;
  private readonly overrides: {
    maxReadBytes?: number;
    maxWriteBytes?: number;
    maxOutputBytes?: number;
    defaultTimeoutMs?: number;
    maxExecTimeoutMs?: number;
  };

  constructor(
    userId: string,
    overrides: {
      maxReadBytes?: number;
      maxWriteBytes?: number;
      maxOutputBytes?: number;
      defaultTimeoutMs?: number;
      maxExecTimeoutMs?: number;
    } = {},
  ) {
    if (typeof userId !== "string" || userId.trim() === "") {
      throw new WorkspaceError("userId must be a non-empty string", "INVALID_INPUT");
    }
    this.userId = userId;
    this.containerName = containerNameFor(userId);
    this.volumeName = volumeNameFor(userId);
    this.overrides = overrides;
  }

  private async deps(): Promise<ClientDeps> {
    return getClient();
  }

  /**
   * Same rules as LocalWorkspace: relative paths only, no `..`, no
   * absolute/drive forms. `/workspace` + rel can never reach the host.
   */
  private resolveSafe(raw: string): string {
    if (typeof raw !== "string" || raw.trim() === "") {
      throw new WorkspaceError("path must be a non-empty string", "INVALID_PATH");
    }
    const normalized = raw.replace(/\\/g, "/").trim();
    if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized) || normalized.startsWith("//")) {
      throw new WorkspaceError(`absolute paths are not allowed: ${raw}`, "ABSOLUTE_PATH");
    }
    const segments = normalized.split("/").filter((segment) => segment.length > 0 && segment !== ".");
    if (segments.some((segment) => segment === "..")) {
      throw new WorkspaceError(`path traversal is not allowed: ${raw}`, "TRAVERSAL");
    }
    return segments.length > 0 ? `${WORKSPACE_ROOT}/${segments.join("/")}` : WORKSPACE_ROOT;
  }

  /**
   * Brings the user's volume + container up: reuses a running container,
   * restarts a stopped one, creates both resources on first use.
   */
  async ensureRunning(): Promise<RunningSandbox> {
    const { client, config } = await this.deps();
    try {
      await client.imageInspect(config.image);
    } catch (error) {
      if (isNotFound(error)) {
        throw new WorkspaceError(
          `sandbox image "${config.image}" is not available. Run \`npm run sandbox:build\` first.`,
          "IMAGE_MISSING",
        );
      }
      throw error;
    }
    await this.ensureVolume(client, config.image);
    const reused = await this.ensureContainer(client, config);
    return {
      volumeName: this.volumeName,
      containerName: this.containerName,
      image: config.image,
      reused,
    };
  }

  private async ensureVolume(client: DockerClientInstance, image: string): Promise<void> {
    try {
      await client.volumeInspect(this.volumeName);
      return;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    await client.volumeCreate({ Name: this.volumeName });
    // Fresh named volumes are root-owned; chown once via a throwaway root
    // container so the sandbox user (uid 1000) can write. AutoRemove
    // deletes the container when it exits.
    const init = await client.containerCreate(
      {
        Image: image,
        Cmd: ["sh", "-c", "chown -R 1000:1000 /workspace || true"],
        AttachStdin: false,
        AttachStdout: false,
        AttachStderr: false,
        OpenStdin: false,
        Tty: false,
        HostConfig: {
          Binds: [`${this.volumeName}:${WORKSPACE_ROOT}`],
          AutoRemove: true,
        },
      },
      { name: `kairo-init-${volumeNameFor(this.userId)}-${Date.now().toString(36)}` },
    );
    await client.containerStart(init.Id ?? "");
    await this.waitExited(client, init.Id ?? "");
  }

  private async ensureContainer(client: DockerClientInstance, config: ClientDeps["config"]): Promise<boolean> {
    let state: ContainerInspectResponse | undefined;
    try {
      state = await client.containerInspect(this.containerName);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    if (state !== undefined) {
      const status = state.State?.Status ?? "";
      if (status === "running") return true;
      if (status === "paused") {
        await client.containerUnpause(this.containerName);
        return true;
      }
      if (status === "created" || status === "exited" || status === "dead") {
        try {
          await client.containerStart(this.containerName);
          return true;
        } catch (error) {
          if (!isNotFound(error)) {
            await client.containerDelete(this.containerName, { force: true }).catch(() => undefined);
          }
        }
      }
    }
    await client.containerCreate(
      {
        Image: config.image,
        Cmd: ["sleep", "infinity"],
        User: SANDBOX_UID_GID,
        WorkingDir: WORKSPACE_ROOT,
        Env: ["HOME=/home/node", "NODE_ENV=production"],
        AttachStdin: false,
        AttachStdout: false,
        AttachStderr: false,
        OpenStdin: false,
        Tty: false,
        HostConfig: {
          Binds: [`${this.volumeName}:${WORKSPACE_ROOT}`],
          Memory: config.memoryBytes,
          MemorySwap: config.memoryBytes,
          NanoCpus: Math.round(config.cpus * 1_000_000_000),
          PidsLimit: config.pidsLimit,
          ReadonlyRootfs: true,
          Tmpfs: { "/tmp": "size=512m", "/home/node": "size=256m" },
          CapDrop: ["ALL"],
          SecurityOpt: ["no-new-privileges"],
          NetworkMode: config.networkMode,
        },
      },
      { name: this.containerName },
    );
    await client.containerStart(this.containerName);
    return false;
  }

  async exec(command: string | string[], opts?: ExecOptions): Promise<ExecResult> {
    await this.ensureRunning();
    const { config } = await this.deps();
    const cwdAbs = this.resolveSafe(opts?.cwd ?? ".");
    const timeoutMs = Math.min(
      opts?.timeoutMs ?? this.overrides.defaultTimeoutMs ?? config.defaultTimeoutMs,
      this.overrides.maxExecTimeoutMs ?? config.maxExecTimeoutMs,
    );
    const maxOutputBytes = Math.min(
      opts?.maxOutputBytes ?? this.overrides.maxOutputBytes ?? config.maxOutputBytes,
      this.overrides.maxOutputBytes ?? config.maxOutputBytes,
    );
    const cmd = Array.isArray(command) ? [...command] : ["bash", "-c", command];
    if (cmd.length === 0) {
      return { exitCode: null, stdout: "", stderr: "empty command", timedOut: false, truncated: false };
    }
    const { client } = await this.deps();
    const exec = await client.containerExec(this.containerName, {
      Cmd: cmd,
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      User: SANDBOX_UID_GID,
      WorkingDir: cwdAbs,
      Env: [...config.execEnv],
    });
    const execId = exec.Id ?? "";
    const stdoutCapture = new CaptureWritable(maxOutputBytes);
    const stderrCapture = new CaptureWritable(maxOutputBytes);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void this.killTimedOutExec(client, execId, "process timed out").catch(() => undefined);
    }, timeoutMs);
    try {
      await client.execStart(execId, stdoutCapture, stderrCapture);
    } catch (error) {
      // A killed exec's socket can close with an error; the result below
      // still carries whatever output was captured before the kill.
      if (!timedOut && !isNotFound(error)) throw error;
    } finally {
      clearTimeout(timer);
    }
    const exitCode = await this.execExitCode(client, execId);
    const stderrText = stderrCapture.text();
    return {
      exitCode,
      stdout: stdoutCapture.text(),
      stderr: timedOut && exitCode === null && stderrText === "" ? "operation timed out" : stderrText,
      timedOut,
      truncated: stdoutCapture.truncated || stderrCapture.truncated,
    };
  }

  async readFile(rawPath: string, limit?: { maxBytes?: number }): Promise<ReadResult> {
    const { config } = await this.deps();
    const abs = this.resolveSafe(rawPath);
    await this.ensureRunning();
    const { client } = await this.deps();
    const maxBytes = Math.min(
      limit?.maxBytes ?? this.overrides.maxReadBytes ?? config.maxReadBytes,
      this.overrides.maxReadBytes ?? config.maxReadBytes,
    );
    let size: number | undefined;
    try {
      const info = await client.containerArchiveInfo(this.containerName, abs);
      size = info.size;
      const mode = info.mode ?? 0;
      if ((mode & 0o170000) === 0o040000) {
        throw new WorkspaceError(`path is a directory: ${rawPath}`, "IS_DIRECTORY");
      }
      const linkTarget = info.linkTarget ?? "";
      if (linkTarget !== "" && !linkTarget.startsWith(`${WORKSPACE_ROOT}/`)) {
        throw new WorkspaceError("symlink points outside the workspace", "SYMLINK_ESCAPE");
      }
    } catch (error) {
      if (isNotFound(error)) {
        throw new WorkspaceError(`no such file: ${rawPath}`, "NOT_FOUND");
      }
      throw error;
    }
    const sink = bufferWritable(maxBytes);
    try {
      await client.containerArchive(this.containerName, abs, sink.stream);
    } catch (error) {
      if (isNotFound(error)) {
        throw new WorkspaceError(`no such file: ${rawPath}`, "NOT_FOUND");
      }
      throw error;
    }
    const tar = await sink.take();
    const bytes = await unpackFirstFileTar(tar, maxBytes);
    const truncated = size !== undefined && size > maxBytes;
    const content = bytes.toString("utf8");
    if (truncated && size !== undefined) {
      return {
        content: `${content}\n\n[truncated: file is ${size} bytes, showing first ${maxBytes}]`,
        truncated: true,
      };
    }
    return { content, truncated };
  }

  async writeFile(rawPath: string, content: string): Promise<WriteResult> {
    const { config } = await this.deps();
    if (typeof content !== "string") {
      throw new WorkspaceError("content must be a string", "INVALID_CONTENT");
    }
    const maxWriteBytes = this.overrides.maxWriteBytes ?? config.maxWriteBytes;
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > maxWriteBytes) {
      throw new WorkspaceError(`file too large: ${bytes} bytes (limit ${maxWriteBytes})`, "TOO_LARGE");
    }
    const abs = this.resolveSafe(rawPath);
    await this.ensureRunning();
    const { client } = await this.deps();
    const rel = abs.slice(`${WORKSPACE_ROOT}/`.length);
    const tar = await packFileTar(rel, Buffer.from(content, "utf8"));
    await client.putContainerArchive(this.containerName, WORKSPACE_ROOT, bufferToNodeReadable(tar), {
      copyUIDGID: "true",
    });
    return { bytes };
  }

  async listFiles(options?: ListOptions): Promise<ListResult> {
    const maxEntries = options?.maxEntries ?? 500;
    const abs = this.resolveSafe(options?.path ?? ".");
    await this.ensureRunning();
    const { client } = await this.deps();
    const prunes = [...SKIP_DIRS].flatMap((name) => ["-name", name, "-o"] as string[]).slice(0, -1);
    const argv = [
      "find",
      abs,
      "-mindepth",
      "1",
      "(",
      ...prunes,
      ")",
      "-prune",
      "-o",
      "-printf",
      "%y\\t%p\\n",
    ];
    const raw = await this.execInternal(client, argv, WORKSPACE_ROOT, LIST_TIMEOUT_MS, LIST_MAX_OUTPUT_BYTES);
    const prefixLength = abs.replace(/\/+$/, "").length + 1;
    type Parsed = { type: string; rel: string };
    const parsed: Parsed[] = [];
    for (const line of raw.stdout.split("\n")) {
      const tabIndex = line.indexOf("\t");
      if (tabIndex < 0) continue;
      const type = line.slice(0, tabIndex);
      const containerPath = line.slice(tabIndex + 1);
      if (type !== "d" && type !== "f" && type !== "l") continue;
      if (!containerPath.startsWith(`${WORKSPACE_ROOT}/`)) continue;
      parsed.push({ type, rel: containerPath.slice(prefixLength) });
    }
    const paths: string[] = [];
    for (const item of parsed) {
      if (paths.length >= maxEntries) break;
      if (item.type === "d") paths.push(`${item.rel}/`);
      else if (item.type === "l") paths.push(`${item.rel}@`);
      else paths.push(item.rel);
    }
    paths.sort((a, b) => a.localeCompare(b));
    return { paths, truncated: parsed.length > paths.length };
  }

  async searchCode(options: {
    query: string;
    path?: string;
    isRegex?: boolean;
    maxResults?: number;
  }): Promise<SearchResult> {
    const query = options.query ?? "";
    if (query.length === 0) {
      throw new WorkspaceError("query must not be empty", "INVALID_QUERY");
    }
    const abs = this.resolveSafe(options.path ?? ".");
    await this.ensureRunning();
    const { client } = await this.deps();
    const maxResults = options.maxResults ?? 200;
    const argv = [
      "rg",
      "--line-number",
      "--no-heading",
      "--color",
      "never",
      "--max-count",
      "5",
      "--max-columns",
      "500",
      options.isRegex === true ? "-e" : "-F",
      query,
      abs,
    ];
    const raw = await this.execInternal(client, argv, WORKSPACE_ROOT, SEARCH_TIMEOUT_MS, SEARCH_MAX_OUTPUT_BYTES);
    const hits: SearchHit[] = [];
    for (const line of raw.stdout.split("\n")) {
      if (hits.length >= maxResults) break;
      const match = /^(.*?):(\d+):(.*)$/.exec(line);
      if (!match) continue;
      if (!match[1]!.startsWith(`${WORKSPACE_ROOT}/`)) continue;
      hits.push({
        path: match[1]!.slice(`${WORKSPACE_ROOT}/`.length),
        line: Number(match[2]),
        text: match[3]!.trimEnd(),
      });
    }
    if (hits.length === 0 && (raw.exitCode ?? 0) >= 2) {
      if (/No such file/i.test(raw.stderr)) {
        throw new WorkspaceError(`search root does not exist: ${options.path ?? "."}`, "NOT_FOUND");
      }
      throw new WorkspaceError(`ripgrep failed: ${raw.stderr.trim().slice(0, 400)}`, "SEARCH_FAILED");
    }
    return { hits, truncated: hits.length >= maxResults };
  }

  /** Internal exec with a fixed timeout kill; argv form, no shell. */
  private async execInternal(
    client: DockerClientInstance,
    argv: string[],
    cwd: string,
    timeoutMs: number,
    maxOutputBytes: number,
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    const exec = await client.containerExec(this.containerName, {
      Cmd: argv,
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      User: SANDBOX_UID_GID,
      WorkingDir: cwd,
    });
    const execId = exec.Id ?? "";
    const stdoutCapture = new CaptureWritable(maxOutputBytes);
    const stderrCapture = new CaptureWritable(maxOutputBytes);
    const timer = setTimeout(() => {
      void this.killTimedOutExec(client, execId, "internal command timed out").catch(() => undefined);
    }, timeoutMs);
    try {
      await client.execStart(execId, stdoutCapture, stderrCapture);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    } finally {
      clearTimeout(timer);
    }
    const exitCode = await this.execExitCode(client, execId);
    return { exitCode, stdout: stdoutCapture.text(), stderr: stderrCapture.text() };
  }

  /**
   * Best-effort kill of a hanging exec's processgroup: docker exposes the
   * exec's in-container Pid via inspect; a sibling exec runs
   * `kill -9 -<pid>` (group: children share the exec's pgid) and falls back
   * to `kill -9 <pid>`. Everything is swallowed — the killed exec's socket
   * closing is what unblocks the caller, not this helper's exit status.
   */
  private async killTimedOutExec(client: DockerClientInstance, execId: string, note: string): Promise<void> {
    try {
      const inspect = await client.execInspect(execId);
      const pid = inspect.Pid;
      if (!pid || pid <= 1) return;
      const attempts: string[][] = [
        ["kill", "-9", `-${pid}`],
        ["kill", "-9", String(pid)],
      ];
      for (const cmd of attempts) {
        try {
          const killer = await client.containerExec(this.containerName, {
            Cmd: cmd,
            AttachStdin: false,
            AttachStdout: false,
            AttachStderr: false,
            Tty: false,
            User: SANDBOX_UID_GID,
          });
          await client.execStart(killer.Id ?? "", null, null, { Detach: true });
        } catch {
          // last attempt may have killed it already, or it died on its own
        }
      }
      void note;
    } catch {
      // container gone / exec gone — the timed-out exec ended on its own
    }
  }

  private async execExitCode(client: DockerClientInstance, execId: string): Promise<number | null> {
    const deadline = Date.now() + EXIT_POLL_DEADLINE_MS;
    for (;;) {
      try {
        const inspect = await client.execInspect(execId);
        if (!inspect.Running && inspect.ExitCode !== null && inspect.ExitCode !== undefined) {
          return inspect.ExitCode;
        }
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
      if (Date.now() >= deadline) {
        return null;
      }
      await sleep(INSPECT_POLL_MS);
    }
  }

  /** Polls until the container exits or disappears (AutoRemove → 404). */
  private async waitExited(client: DockerClientInstance, id: string): Promise<void> {
    const deadline = Date.now() + WAIT_EXITED_DEADLINE_MS;
    for (;;) {
      try {
        const inspect = await client.containerInspect(id);
        if (inspect.State?.Running !== true) return;
      } catch (error) {
        if (isNotFound(error)) return;
        throw error;
      }
      if (Date.now() >= deadline) return;
      await sleep(INSPECT_POLL_MS);
    }
  }

  /** Live container status for UI chips. */
  async status(): Promise<SandboxStatus> {
    const { client, config } = await this.deps();
    try {
      const inspect = await client.containerInspect(this.containerName);
      return {
        running: inspect.State?.Running === true,
        containerName: this.containerName,
        volumeName: this.volumeName,
        image: config.image,
      };
    } catch (error) {
      if (isNotFound(error)) {
        return { running: false, containerName: this.containerName, volumeName: this.volumeName, image: config.image };
      }
      throw error;
    }
  }

  /** Stops the container but keeps the volume, so the agent's files persist. */
  async stop(): Promise<void> {
    const { client } = await this.deps();
    try {
      await client.containerStop(this.containerName, { timeout: 10 });
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
}
