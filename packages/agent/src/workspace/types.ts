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

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

export interface ListOptions {
  path?: string;
  maxEntries?: number;
}

export interface ReadResult {
  content: string;
  truncated: boolean;
}

export interface WriteResult {
  bytes: number;
}

export interface ListResult {
  paths: string[];
  truncated: boolean;
}

export interface SearchResult {
  hits: SearchHit[];
  truncated: boolean;
}

/**
 * The agent's computer. Stage 5 implements this on the local filesystem;
 * Stage 6 implements it inside a per-user Docker sandbox.
 *
 * `command` as a string is a shell command (pipes etc. allowed) — intended
 * only for sandboxed execution. Array form is executed without a shell and
 * must never be built by string concatenation from untrusted input.
 */
export interface Workspace {
  readonly rootLabel: string;
  readFile(path: string, opts?: { maxBytes?: number }): Promise<ReadResult>;
  writeFile(path: string, content: string): Promise<WriteResult>;
  listFiles(opts?: ListOptions): Promise<ListResult>;
  searchCode(opts: {
    query: string;
    path?: string;
    isRegex?: boolean;
    maxResults?: number;
  }): Promise<SearchResult>;
  exec(
    command: string | string[],
    opts?: ExecOptions,
  ): Promise<ExecResult>;
}

export class WorkspaceError extends Error {
  readonly code: string;
  constructor(message: string, code = "WORKSPACE_ERROR") {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
  }
}
