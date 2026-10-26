import { tool, type ToolSet } from "ai";
import type { Workspace } from "../workspace/types.js";
import {
  executeFinish,
  executeListFiles,
  executeReadFile,
  executeRunShell,
  executeRunTests,
  executeSearchCode,
  executeWriteFile,
  type ExecutorOptions,
} from "./executors.js";
import {
  finishInput,
  listFilesInput,
  readFileInput,
  runShellInput,
  runTestsInput,
  searchCodeInput,
  writeFileInput,
} from "./schemas.js";

export interface AgentToolOptions {
  maxOutputBytes: number;
  toolTimeoutMs: number;
}

export function createAgentTools(
  workspace: Workspace,
  opts: AgentToolOptions,
): ToolSet {
  const execOpts: ExecutorOptions = {
    maxOutputBytes: opts.maxOutputBytes,
    toolTimeoutMs: opts.toolTimeoutMs,
  };

  return {
    list_files: tool({
      description:
        "List files and directories under a workspace path. Directories end with '/', symlinks with '@'.",
      inputSchema: listFilesInput,
      execute: async (input) => executeListFiles(workspace, input),
    }),
    read_file: tool({
      description:
        "Read a text file from the workspace. Optionally restrict to a line range.",
      inputSchema: readFileInput,
      execute: async (input) => executeReadFile(workspace, input, execOpts),
    }),
    write_file: tool({
      description:
        "Create or overwrite a file with the given full content. Parent directories are created automatically.",
      inputSchema: writeFileInput,
      execute: async (input) => executeWriteFile(workspace, input),
    }),
    search_code: tool({
      description:
        "Search file contents in the workspace. Literal text by default; set isRegex for a regular expression.",
      inputSchema: searchCodeInput,
      execute: async (input) => executeSearchCode(workspace, input),
    }),
    run_shell: tool({
      description:
        "Run a shell command inside the workspace (timeout enforced, output truncated). Use for build/inspection commands.",
      inputSchema: runShellInput,
      execute: async (input) => executeRunShell(workspace, input, execOpts),
    }),
    run_tests: tool({
      description:
        "Run the project's test suite (npm test or pytest by default; pass command to override). Always run this before finishing.",
      inputSchema: runTestsInput,
      execute: async (input) => executeRunTests(workspace, input, execOpts),
    }),
    finish: tool({
      description:
        "End the task. Call exactly once, after the work is done and tests have been run.",
      inputSchema: finishInput,
      execute: async (input) => executeFinish(workspace, input),
    }),
  };
}
