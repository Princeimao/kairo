import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
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
} from "./types.js";

const DEFAULT_MAX_READ_BYTES = 1_048_576;
const DEFAULT_MAX_WRITE_BYTES = 1_048_576;
const DEFAULT_MAX_OUTPUT_BYTES = 20_000;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_MAX_SEARCH_RESULTS = 200;

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

/** Environment variables forwarded to child processes. Nothing else is passed. */
const CHILD_ENV_ALLOWLIST = [
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "TMP",
  "TEMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "LANG",
  "LC_ALL",
  "TZ",
  "NODE_OPTIONS",
];

export interface LocalWorkspaceOptions {
  root: string;
  maxReadBytes?: number;
  maxWriteBytes?: number;
  maxOutputBytes?: number;
  defaultTimeoutMs?: number;
}

export class LocalWorkspace implements Workspace {
  readonly rootLabel: string;
  private readonly rootAbs: string;
  private readonly maxReadBytes: number;
  private readonly maxWriteBytes: number;
  private readonly maxOutputBytes: number;
  private readonly defaultTimeoutMs: number;

  constructor(opts: LocalWorkspaceOptions) {
    this.rootAbs = path.resolve(opts.root);
    this.rootLabel = path.basename(this.rootAbs);
    this.maxReadBytes = opts.maxReadBytes ?? DEFAULT_MAX_READ_BYTES;
    this.maxWriteBytes = opts.maxWriteBytes ?? DEFAULT_MAX_WRITE_BYTES;
    this.maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private isInsideRoot(candidate: string): boolean {
    const rel = path.relative(this.rootAbs, candidate);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  }

  private resolveSafe(relPath: string): string {
    if (typeof relPath !== "string" || relPath.trim() === "") {
      throw new WorkspaceError("path must be a non-empty string", "INVALID_PATH");
    }
    const normalized = relPath.replace(/\\/g, "/").trim();
    if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized) || normalized.startsWith("//")) {
      throw new WorkspaceError(`absolute paths are not allowed: ${relPath}`, "ABSOLUTE_PATH");
    }
    const segments = normalized.split("/");
    if (segments.some((s) => s === "..")) {
      throw new WorkspaceError(`path traversal is not allowed: ${relPath}`, "TRAVERSAL");
    }
    const abs = path.resolve(this.rootAbs, normalized);
    if (!this.isInsideRoot(abs)) {
      throw new WorkspaceError(`path escapes the workspace: ${relPath}`, "TRAVERSAL");
    }
    return abs;
  }

  private async nearestExisting(abs: string): Promise<string> {
    let current = abs;
    for (;;) {
      try {
        await access(current, fsConstants.F_OK);
        return current;
      } catch {
        const parent = path.dirname(current);
        if (parent === current) return current;
        current = parent;
      }
    }
  }

  private async assertRealPathInside(abs: string): Promise<string> {
    const real = await realpath(abs);
    if (!this.isInsideRoot(path.resolve(real))) {
      throw new WorkspaceError(
        "symlink points outside the workspace",
        "SYMLINK_ESCAPE",
      );
    }
    return real;
  }

  async readFile(relPath: string, opts?: { maxBytes?: number }): Promise<ReadResult> {
    const abs = this.resolveSafe(relPath);
    const real = await this.assertRealPathInside(abs);
    const stats = await lstat(real);
    if (stats.isDirectory()) {
      throw new WorkspaceError(`path is a directory: ${relPath}`, "IS_DIRECTORY");
    }
    const maxBytes = Math.min(opts?.maxBytes ?? this.maxReadBytes, this.maxReadBytes);
    if (stats.size > maxBytes) {
      const handle = await createReadStream(real, { start: 0, end: maxBytes - 1 });
      const chunks: Buffer[] = [];
      for await (const chunk of handle) chunks.push(chunk as Buffer);
      return {
        content: Buffer.concat(chunks).toString("utf8") + `\n\n[truncated: file is ${stats.size} bytes, showing first ${maxBytes}]`,
        truncated: true,
      };
    }
    const content = await readFile(real, "utf8");
    return { content, truncated: false };
  }

  async writeFile(relPath: string, content: string): Promise<WriteResult> {
    if (typeof content !== "string") {
      throw new WorkspaceError("content must be a string", "INVALID_CONTENT");
    }
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > this.maxWriteBytes) {
      throw new WorkspaceError(
        `file too large: ${bytes} bytes (limit ${this.maxWriteBytes})`,
        "TOO_LARGE",
      );
    }
    const abs = this.resolveSafe(relPath);
    const ancestor = await this.nearestExisting(path.dirname(abs));
    await this.assertRealPathInside(ancestor);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    return { bytes };
  }

  async listFiles(opts?: ListOptions): Promise<ListResult> {
    const relDir = opts?.path ?? ".";
    const abs = this.resolveSafe(relDir);
    const real = await this.assertRealPathInside(abs);
    const maxEntries = opts?.maxEntries ?? DEFAULT_MAX_ENTRIES;
    const paths: string[] = [];
    let truncated = false;
    const walk = async (dirAbs: string, prefix: string): Promise<void> => {
      const entries = await readdir(dirAbs, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (paths.length >= maxEntries) {
          truncated = true;
          return;
        }
        const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        if (entry.isSymbolicLink()) {
          paths.push(`${rel}@`);
          continue;
        }
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          paths.push(`${rel}/`);
          await walk(path.join(dirAbs, entry.name), rel);
        } else if (entry.isFile()) {
          paths.push(rel);
        }
      }
    };
    await walk(real, relDir === "." ? "" : relDir.replace(/\\/g, "/").replace(/\/+$/, ""));
    return { paths, truncated };
  }

  async searchCode(opts: {
    query: string;
    path?: string;
    isRegex?: boolean;
    maxResults?: number;
  }): Promise<SearchResult> {
    const query = opts.query ?? "";
    if (query.length === 0) {
      throw new WorkspaceError("query must not be empty", "INVALID_QUERY");
    }
    const maxResults = opts.maxResults ?? DEFAULT_MAX_SEARCH_RESULTS;
    const searchRootRel = opts.path ?? ".";
    const abs = this.resolveSafe(searchRootRel);
    const real = await this.assertRealPathInside(abs);

    const rgResult = await this.tryRipgrep(query, real, opts.isRegex === true, maxResults);
    if (rgResult) return rgResult;

    return this.fallbackSearch(query, real, searchRootRel, opts.isRegex === true, maxResults);
  }

  private async tryRipgrep(
    query: string,
    absRoot: string,
    isRegex: boolean,
    maxResults: number,
  ): Promise<SearchResult | null> {
    const args = [
      "--line-number",
      "--no-heading",
      "--color",
      "never",
      "--max-count",
      "5",
      isRegex ? query : "-F",
      ...(isRegex ? [] : [query]),
      absRoot,
    ];
    const result = await this.spawnCapture(["rg", ...args], {
      cwd: this.rootAbs,
      timeoutMs: 15_000,
      maxOutputBytes: 200_000,
    });
    if (result.spawnFailed) return null;
    const hits: SearchHit[] = [];
    for (const line of result.stdout.split("\n")) {
      if (hits.length >= maxResults) break;
      const match = /^(.*?):(\d+):(.*)$/.exec(line);
      if (!match) continue;
      const rel = path.relative(this.rootAbs, match[1]!).split(path.sep).join("/");
      hits.push({ path: rel, line: Number(match[2]), text: match[3]!.trimEnd() });
    }
    return { hits, truncated: hits.length >= maxResults };
  }

  private async fallbackSearch(
    query: string,
    absRoot: string,
    relRoot: string,
    isRegex: boolean,
    maxResults: number,
  ): Promise<SearchResult> {
    let pattern: RegExp;
    try {
      pattern = isRegex
        ? new RegExp(query)
        : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    } catch {
      throw new WorkspaceError("invalid regular expression", "INVALID_REGEX");
    }
    const hits: SearchHit[] = [];
    let truncated = false;
    const walk = async (dirAbs: string, prefix: string): Promise<void> => {
      if (hits.length >= maxResults) {
        truncated = true;
        return;
      }
      const entries = await readdir(dirAbs, { withFileTypes: true });
      for (const entry of entries) {
        if (hits.length >= maxResults) {
          truncated = true;
          return;
        }
        const abs = path.join(dirAbs, entry.name);
        const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          await walk(abs, rel);
        } else if (entry.isFile()) {
          const stats = await lstat(abs);
          if (stats.size > this.maxReadBytes) continue;
          if (await isProbablyBinary(abs)) continue;
          const content = await readFile(abs, "utf8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (hits.length >= maxResults) {
              truncated = true;
              return;
            }
            const line = lines[i]!;
            if (line.length > 500) continue;
            if (pattern.test(line)) {
              hits.push({ path: rel, line: i + 1, text: line.trimEnd() });
            }
          }
        }
      }
    };
    const prefixBase = relRoot === "." ? "" : relRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    await walk(absRoot, prefixBase);
    return { hits, truncated };
  }

  async exec(command: string | string[], opts?: ExecOptions): Promise<ExecResult> {
    const cwdRel = opts?.cwd ?? ".";
    const cwdAbs = this.resolveSafe(cwdRel);
    let cwdReal: string;
    try {
      cwdReal = await this.assertRealPathInside(cwdAbs);
    } catch {
      throw new WorkspaceError(
        `cwd does not exist or escapes the workspace: ${cwdRel}`,
        "INVALID_CWD",
      );
    }
    const timeoutMs = Math.min(opts?.timeoutMs ?? this.defaultTimeoutMs, 600_000);
    const maxOutputBytes = Math.min(
      opts?.maxOutputBytes ?? this.maxOutputBytes,
      this.maxOutputBytes,
    );
    return this.spawnCapture(command, {
      cwd: cwdReal,
      timeoutMs,
      maxOutputBytes,
    });
  }

  private spawnCapture(
    command: string | string[],
    opts: { cwd: string; timeoutMs: number; maxOutputBytes: number },
  ): Promise<ExecResult & { spawnFailed?: boolean }> {
    return new Promise((resolvePromise) => {
      const isArray = Array.isArray(command);
      if (isArray && command.length === 0) {
        resolvePromise({
          exitCode: null,
          stdout: "",
          stderr: "empty command",
          timedOut: false,
          truncated: false,
        });
        return;
      }
      const file = isArray ? command[0]! : command;
      const args = isArray ? command.slice(1) : [];
      const childEnv: NodeJS.ProcessEnv = {};
      for (const key of CHILD_ENV_ALLOWLIST) {
        const value = process.env[key];
        if (value !== undefined) childEnv[key] = value;
      }
      const child = spawn(file, args, {
        cwd: opts.cwd,
        env: childEnv,
        shell: !isArray,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout: Buffer = Buffer.alloc(0);
      let stderr: Buffer = Buffer.alloc(0);
      let truncated = false;
      let timedOut = false;
      let settled = false;

      const append = (current: Buffer, chunk: Buffer): Buffer => {
        if (current.length >= opts.maxOutputBytes) {
          truncated = true;
          return current;
        }
        const remaining = opts.maxOutputBytes - current.length;
        if (chunk.length > remaining) {
          truncated = true;
          return Buffer.concat([current, chunk.subarray(0, remaining)]);
        }
        return Buffer.concat([current, chunk]);
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout = append(stdout, chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });

      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child.pid);
      }, opts.timeoutMs);

      const finish = (exitCode: number | null, spawnFailed = false): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise({
          exitCode,
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8"),
          timedOut,
          truncated,
          spawnFailed,
        });
      };

      child.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") {
          stderr = append(stderr, Buffer.from(`\n${error.message}`));
        }
        finish(null, error.code === "ENOENT");
      });
      child.on("close", (code) => finish(code));
    });
  }
}

function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already dead
    }
  }
}

async function isProbablyBinary(abs: string): Promise<boolean> {
  try {
    const handle = await createReadStream(abs, { start: 0, end: 4095 });
    for await (const chunk of handle) {
      const buf = chunk as Buffer;
      if (buf.includes(0)) return true;
      break;
    }
  } catch {
    return true;
  }
  return false;
}
