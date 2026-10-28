import { Writable } from "node:stream";
import { randomUUID } from "node:crypto";
import type { WritableStream } from "node:stream/web";
import {
  DockerClient,
  NotFoundError,
  type ContainerInspectResponse,
  type DockerClient as DockerClientInstance,
} from "@docker/node-sdk";
import { WorkspaceError } from "./errors.js";
import { bufferToNodeReadable, packFileTar, unpackFirstFileTar } from "./archive.js";
import { getContainerArchiveRaw, NotFoundSignal, putContainerArchiveRaw } from "./http-bypass.js";
import {
  containerNameFor,
  loadSandboxConfig,
  SANDBOX_UID_GID,
  sanitizeToken,
  volumeNameFor,
} from "./config.js";
import {
  HARNESS_LABEL,
  HARNESS_LABEL_VALUE,
  llmTokenFor,
  serverPasswordFor,
} from "./credentials.js";

const INSPECT_POLL_MS = 50;
const EXIT_POLL_DEADLINE_MS = 5_000;
const WAIT_EXITED_DEADLINE_MS = 30_000;
const WORKSPACE_ROOT = "/workspace";

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

export interface ReadResult {
  content: string;
  truncated: boolean;
}

export interface WriteResult {
  bytes: number;
}

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

export class DockerWorkspace {
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
   * restarts a stopped one, creates both resources on first use. A container
   * that doesn't match the current harness spec (label, image, per-user
   * network, derived credentials) is recreated so upgrades never leave a
   * stale `sleep` container behind.
   */
  async ensureRunning(): Promise<RunningSandbox> {
    const { client, config } = await this.deps();
    let imageId: string | undefined;
    try {
      const image = await client.imageInspect(config.image);
      imageId = image.Id;
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
    const reused = await this.ensureContainer(client, config, imageId);
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

  /** One bridge network per user: containers of different users never share L2. */
  private networkNameFor(config: ClientDeps["config"]): string {
    if (config.networkMode === "none") return "none";
    if (config.networkMode === "bridge") return "bridge";
    return `kairo-net-${sanitizeToken(this.userId)}`;
  }

  private async ensureNetwork(client: DockerClientInstance, name: string): Promise<void> {
    if (name === "none" || name === "bridge") return;
    try {
      await client.networkInspect(name);
      return;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    await client.networkCreate({
      Name: name,
      Driver: "bridge",
      Labels: { [HARNESS_LABEL]: "network" },
    });
  }

  /** Container env owned by the harness (derived credentials, stable HOME). */
  private harnessEnv(): string[] {
    return [
      "HOME=/home/node",
      "NODE_ENV=production",
      `OPENCODE_SERVER_PASSWORD=${serverPasswordFor(this.containerName)}`,
      `KAIRO_LLM_TOKEN=${llmTokenFor(this.containerName)}`,
    ];
  }

  /**
   * An existing container is only reused when it matches the current spec:
   * harness label, image id, network, and derived credentials. Anything else
   * (old `sleep` containers, rotated SANDBOX_SECRET, rebuilt image, network
   * mode change) falls through to a recreate.
   */
  private isCompatible(
    state: ContainerInspectResponse,
    wantedNetwork: string,
    imageId?: string,
  ): boolean {
    const labels = state.Config?.Labels ?? {};
    if (labels[HARNESS_LABEL] !== HARNESS_LABEL_VALUE) return false;
    if ((state.HostConfig?.NetworkMode ?? "") !== wantedNetwork) return false;
    if (imageId !== undefined && state.Image !== undefined && state.Image !== imageId) return false;
    const env = new Map<string, string>();
    for (const entry of state.Config?.Env ?? []) {
      const at = entry.indexOf("=");
      if (at > 0) env.set(entry.slice(0, at), entry.slice(at + 1));
    }
    if (env.get("OPENCODE_SERVER_PASSWORD") !== serverPasswordFor(this.containerName)) return false;
    if (env.get("KAIRO_LLM_TOKEN") !== llmTokenFor(this.containerName)) return false;
    return true;
  }

  private async ensureContainer(
    client: DockerClientInstance,
    config: ClientDeps["config"],
    imageId?: string,
  ): Promise<boolean> {
    const wantedNetwork = this.networkNameFor(config);
    await this.ensureNetwork(client, wantedNetwork);

    let state: ContainerInspectResponse | undefined;
    try {
      state = await client.containerInspect(this.containerName);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }

    if (state !== undefined) {
      const compatible = this.isCompatible(state, wantedNetwork, imageId);
      const status = state.State?.Status ?? "";
      if (compatible) {
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
      } else {
        await client.containerDelete(this.containerName, { force: true }).catch(() => undefined);
      }
    }

    await client.containerCreate(
      {
        Image: config.image,
        Cmd: ["opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096"],
        User: SANDBOX_UID_GID,
        WorkingDir: WORKSPACE_ROOT,
        Env: this.harnessEnv(),
        Labels: { [HARNESS_LABEL]: HARNESS_LABEL_VALUE },
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
          NetworkMode: wantedNetwork,
          // Lets the container reach the host-side LLM proxy + GitHub API.
          ExtraHosts:
            wantedNetwork === "none" ? undefined : ["host.docker.internal:host-gateway"],
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
    const execMarker = `kasx-${randomUUID()}`;
    const exec = await client.containerExec(this.containerName, {
      Cmd: cmd,
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      User: SANDBOX_UID_GID,
      WorkingDir: cwdAbs,
      Env: [...config.execEnv, `KAIRO_EXEC_ID=${execMarker}`],
    });
    const execId = exec.Id ?? "";
    const stdoutCapture = new CaptureWritable(maxOutputBytes);
    const stderrCapture = new CaptureWritable(maxOutputBytes);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void this.killTimedOutExec(client, execMarker, "process timed out").catch(() => undefined);
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
    let raw: Awaited<ReturnType<typeof getContainerArchiveRaw>>;
    try {
      raw = await getContainerArchiveRaw(client, this.containerName, abs, maxBytes);
    } catch (error) {
      if (error instanceof NotFoundSignal) {
        throw new WorkspaceError(`no such file: ${rawPath}`, "NOT_FOUND");
      }
      throw error;
    }
    const unpacked = await unpackFirstFileTar(raw.buffer, maxBytes);
    const content = unpacked.bytes.toString("utf8");
    const truncated = unpacked.truncatedTar;
    if (truncated) {
      return {
        content: `${content}\n\n[truncated: file exceeds the ${maxBytes} byte read cap]`,
        truncated: true,
      };
    }
    return { content, truncated: false };
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
    const tarBuffer = await packFileTar(rel, Buffer.from(content, "utf8"));
    await putContainerArchiveRaw(client, this.containerName, WORKSPACE_ROOT, bufferToNodeReadable(tarBuffer), {
      copyUIDGID: "true",
    });
    return { bytes };
  }

  /**
   * Best-effort kill of a hanging exec discovered via its unique env marker
   * (ExecInspect's Pid is a host-level pid â€” useless inside the container's
   * namespace). The scanner exec reads /proc envelopes for the marker and
   * SIGKILLs the matching process group (the shim gives every exec its own
   * pgid), which sweeps spawned children too.
   */
  private async killTimedOutExec(client: DockerClientInstance, execMarker: string, note: string): Promise<void> {
    const script = [
      `MARKER=${JSON.stringify(execMarker)}`,
      'for d in /proc/[0-9]*; do',
      '  if [ -r "$d/environ" ]; then',
      '    if grep -aq "$MARKER" "$d/environ" 2>/dev/null; then',
      '      pid=$(basename "$d")',
      '      kill -9 -- "-$pid" 2>/dev/null',
      '      kill -9 "$pid" 2>/dev/null',
      '    fi',
      '  fi',
      'done',
    ].join("\n");
    try {
      const killer = await client.containerExec(this.containerName, {
        Cmd: ["bash", "-c", script],
        AttachStdin: false,
        AttachStdout: false,
        AttachStderr: false,
        Tty: false,
        User: SANDBOX_UID_GID,
      });
      await client.execStart(killer.Id ?? "", null, null, { Detach: true });
    } catch {
      // Everything is best-effort: the caller waits for socket close either way.
    }
    void note;
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

  /** Polls until the container exits or disappears (AutoRemove â†’ 404). */
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
