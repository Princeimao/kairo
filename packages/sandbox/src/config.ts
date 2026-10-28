import { randomBytes } from "node:crypto";
import { WorkspaceError } from "./errors.js";

const MB = 1024 * 1024;

/** Values are per-user sandbox defaults; all overridable through env. */
export interface SandboxConfig {
  /** Image the user container boots from (built by `npm run sandbox:build`). */
  image: string;
  /** Connect to the daemon over TCP (tcp://host:port) or a socket path, else autodetect. */
  dockerHost?: string;
  /** Host network mode for user containers. "none" disables egress entirely. */
  networkMode: string;
  memoryBytes: number;
  cpus: number;
  pidsLimit: number;
  volumeSpaceBytes: number;
  maxReadBytes: number;
  maxWriteBytes: number;
  maxOutputBytes: number;
  defaultTimeoutMs: number;
  maxExecTimeoutMs: number;
  execEnv: string[];
}

function intEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function strEnv(raw: string | undefined, fallback: string, allowed?: readonly string[]): string {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (allowed && !allowed.includes(raw)) return fallback;
  return raw;
}

export function loadSandboxConfig(env: NodeJS.ProcessEnv = process.env): SandboxConfig {
  let dockerHost: string | undefined;
  const rawHost = env.KAIRO_SANDBOX_DOCKER_HOST;
  if (rawHost !== undefined && rawHost.trim() !== "") {
    if (!/^(tcp|unix|npipe):\/\//.test(rawHost)) {
      throw new WorkspaceError(
        `KAIRO_SANDBOX_DOCKER_HOST must be tcp://, unix:// or npipe:// (got: ${rawHost})`,
        "INVALID_ENV",
      );
    }
    dockerHost = normalizeDockerHost(rawHost);
  } else {
    dockerHost = defaultDockerHost();
  }
  return {
    image: env.KAIRO_SANDBOX_IMAGE?.trim() || "kairo-sandbox:latest",
    dockerHost,
    networkMode: strEnv(env.KAIRO_SANDBOX_NETWORK, "bridge", ["bridge", "none"]),
    memoryBytes: intEnv(env.KAIRO_SANDBOX_MEMORY_MB, 1536) * MB,
    cpus: intEnv(env.KAIRO_SANDBOX_CPUS, 2),
    pidsLimit: intEnv(env.KAIRO_SANDBOX_PIDS_LIMIT, 256),
    volumeSpaceBytes: intEnv(env.KAIRO_SANDBOX_VOLUME_MB, 2048) * MB,
    maxReadBytes: intEnv(env.KAIRO_SANDBOX_MAX_READ_BYTES, 2 * MB),
    maxWriteBytes: intEnv(env.KAIRO_SANDBOX_MAX_WRITE_BYTES, 2 * MB),
    maxOutputBytes: intEnv(env.KAIRO_SANDBOX_MAX_OUTPUT_BYTES, 20_000),
    defaultTimeoutMs: intEnv(env.KAIRO_SANDBOX_DEFAULT_TIMEOUT_MS, 60_000),
    maxExecTimeoutMs: intEnv(env.KAIRO_SANDBOX_MAX_EXEC_TIMEOUT_MS, 600_000),
    execEnv: [
      "HOME=/home/node",
      "TMPDIR=/tmp",
      "LANG=C.UTF-8",
      "LC_ALL=C.UTF-8",
    ],
  };
}

/** The uid/gid everything inside the sandbox runs as (a non-root user in the image). */
export const SANDBOX_UID_GID = "1000:1000";

/**
 * Docker names allow [a-zA-Z0-9][a-zA-Z0-9_.-]*. User ids are cuids but this
 * stays safe even for other id shapes; anything illegal is replaced with a
 * short random tag so sandbox resources stay uniquely addressable.
 */
export function sanitizeToken(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_.-]/g, "").replace(/^[^a-zA-Z0-9]+/, "");
  if (cleaned === "") {
    return randomBytes(10).toString("hex");
  }
  return cleaned;
}

export function volumeNameFor(userId: string): string {
  return `kairo-ws-${sanitizeToken(userId)}`;
}

export function containerNameFor(userId: string): string {
  return `kairo-sbx-${sanitizeToken(userId)}`;
}

/*
 * Formats a Windows named pipe reference the way the official node SDK
 * expects: `npipe:...` strings lose their "npipe:" prefix verbatim, so the
 * remainder must be a Node-valid pipe path — `//./pipe/<name>` (two leading
 * slashes). Users writing the canonical `npipe:////./pipe/<name>` are
 * normalized automatically.
 */
export function defaultDockerHost(host: NodeJS.Platform = process.platform): string | undefined {
  if (host !== "win32") return undefined;
  return "npipe://./pipe/docker_engine";
}

export function normalizeDockerHost(raw: string): string {
  if (!raw.startsWith("npipe:")) return raw;
  const pipeName = raw.replace(/^npipe:\/+\.?\/?pipe\//, "").replace(/\/+$/, "");
  if (pipeName !== "" && !pipeName.includes("/")) {
    return `npipe://./pipe/${pipeName}`;
  }
  return raw;
}
