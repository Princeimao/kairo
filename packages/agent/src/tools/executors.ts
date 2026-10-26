import type { Workspace } from "../workspace/types.js";
import { WorkspaceError } from "../workspace/types.js";
import type {
  FinishInput,
  ListFilesInput,
  ReadFileInput,
  RunShellInput,
  RunTestsInput,
  SearchCodeInput,
  WriteFileInput,
} from "./schemas.js";

export interface ToolOutput {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface ExecutorOptions {
  maxOutputBytes: number;
  toolTimeoutMs: number;
}

export function truncateText(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) return text;
  return (
    buffer.subarray(0, maxBytes).toString("utf8") +
    `\n\n[truncated: ${buffer.length} bytes total, showing first ${maxBytes}]`
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof WorkspaceError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

async function guard<T>(fn: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await fn();
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function executeListFiles(
  workspace: Workspace,
  input: ListFilesInput,
): Promise<ToolOutput> {
  const result = await guard(() => workspace.listFiles({ path: input.path }));
  if (!("paths" in result)) return result;
  return {
    ok: true,
    paths: result.paths.slice(0, 500),
    truncated: result.truncated || result.paths.length > 500,
  };
}

export async function executeReadFile(
  workspace: Workspace,
  input: ReadFileInput,
  opts: ExecutorOptions,
): Promise<ToolOutput> {
  const result = await guard(() =>
    workspace.readFile(input.path, { maxBytes: opts.maxOutputBytes }),
  );
  if (!("content" in result)) return result;
  let content = result.content;
  let startLine = 1;
  const lines = content.split("\n");
  if (input.startLine || input.endLine) {
    const start = Math.max(1, input.startLine ?? 1);
    const end = Math.min(lines.length, input.endLine ?? lines.length);
    startLine = start;
    content = lines.slice(start - 1, end).join("\n");
  }
  return {
    ok: true,
    path: input.path,
    startLine,
    totalLines: lines.length,
    truncated: result.truncated,
    content: truncateText(content, opts.maxOutputBytes),
  };
}

export async function executeWriteFile(
  workspace: Workspace,
  input: WriteFileInput,
): Promise<ToolOutput> {
  const result = await guard(() => workspace.writeFile(input.path, input.content));
  if (!("bytes" in result)) return result;
  return { ok: true, path: input.path, bytes: result.bytes };
}

export async function executeSearchCode(
  workspace: Workspace,
  input: SearchCodeInput,
): Promise<ToolOutput> {
  const result = await guard(() =>
    workspace.searchCode({
      query: input.query,
      path: input.path,
      isRegex: input.isRegex === true,
    }),
  );
  if (!("hits" in result)) return result;
  return { ok: true, hits: result.hits.slice(0, 100), truncated: result.truncated };
}

export async function executeRunShell(
  workspace: Workspace,
  input: RunShellInput,
  opts: ExecutorOptions,
): Promise<ToolOutput> {
  const result = await guard(() =>
    workspace.exec(input.command, {
      cwd: input.cwd,
      timeoutMs: Math.min(input.timeoutMs ?? opts.toolTimeoutMs, 120_000),
      maxOutputBytes: opts.maxOutputBytes,
    }),
  );
  if (!("exitCode" in result)) return result;
  return {
    ok: result.exitCode === 0 && !result.timedOut,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    truncated: result.truncated,
    stdout: truncateText(result.stdout, opts.maxOutputBytes),
    stderr: truncateText(result.stderr, opts.maxOutputBytes),
  };
}

export async function executeRunTests(
  workspace: Workspace,
  input: RunTestsInput,
  opts: ExecutorOptions,
): Promise<ToolOutput> {
  let command: string[] | null = null;
  if (input.command?.trim()) {
    // Explicit override is treated as a shell command (agents need flags/pipes).
    return executeRunShell(
      workspace,
      { command: input.command, timeoutMs: Math.min(opts.toolTimeoutMs * 2, 300_000) },
      opts,
    );
  }
  let rootEntries: string[] = [];
  try {
    const listing = await workspace.listFiles({ maxEntries: 2000 });
    rootEntries = listing.paths;
  } catch {
    rootEntries = [];
  }
  const hasPackageJson = rootEntries.includes("package.json");
  const hasPythonMarker = ["pyproject.toml", "pytest.ini", "setup.cfg"].some((marker) =>
    rootEntries.includes(marker),
  );
  if (hasPackageJson) {
    command = ["npm", "test"];
  } else if (hasPythonMarker) {
    command = [process.platform === "win32" ? "python" : "python3", "-m", "pytest", "-q"];
  }
  if (!command) {
    return {
      ok: false,
      error:
        "no test runner detected (no package.json and no Python test markers). Pass an explicit command.",
    };
  }
  const result = await guard(() =>
    workspace.exec(command!, {
      timeoutMs: Math.min(opts.toolTimeoutMs * 2, 300_000),
      maxOutputBytes: opts.maxOutputBytes,
    }),
  );
  if (!("exitCode" in result)) return result;
  return {
    ok: result.exitCode === 0 && !result.timedOut,
    command: command.join(" "),
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    truncated: result.truncated,
    stdout: truncateText(result.stdout, opts.maxOutputBytes),
    stderr: truncateText(result.stderr, opts.maxOutputBytes),
  };
}

export async function executeFinish(
  _workspace: Workspace,
  input: FinishInput,
): Promise<ToolOutput> {
  return {
    ok: true,
    recorded: true,
    success: input.success,
    summary: input.summary,
    ...(input.testResults ? { testResults: input.testResults } : {}),
  };
}
