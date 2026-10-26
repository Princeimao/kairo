import { z } from "zod";
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
  type ToolOutput,
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

/**
 * JSON-action fallback for models whose native tool calling is unreliable.
 * The model emits exactly one JSON object: { "tool": "<name>", ...args }.
 * The same executors used by the native tools are called.
 */
export const actionSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("list_files"), ...listFilesInput.shape }),
  z.object({ tool: z.literal("read_file"), ...readFileInput.shape }),
  z.object({ tool: z.literal("write_file"), ...writeFileInput.shape }),
  z.object({ tool: z.literal("search_code"), ...searchCodeInput.shape }),
  z.object({ tool: z.literal("run_shell"), ...runShellInput.shape }),
  z.object({ tool: z.literal("run_tests"), ...runTestsInput.shape }),
  z.object({ tool: z.literal("finish"), ...finishInput.shape }),
]);

export type Action = z.infer<typeof actionSchema>;

const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/i;

export function parseAction(text: string): Action | null {
  const candidates: string[] = [];
  const fenced = FENCE_RE.exec(text);
  if (fenced?.[1]) candidates.push(fenced[1]);
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }
  candidates.push(text);
  for (const candidate of candidates) {
    try {
      const parsed = actionSchema.safeParse(JSON.parse(candidate.trim()));
      if (parsed.success) return parsed.data;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export async function executeAction(
  workspace: Workspace,
  action: Action,
  opts: ExecutorOptions,
): Promise<ToolOutput> {
  switch (action.tool) {
    case "list_files":
      return executeListFiles(workspace, action);
    case "read_file":
      return executeReadFile(workspace, action, opts);
    case "write_file":
      return executeWriteFile(workspace, action);
    case "search_code":
      return executeSearchCode(workspace, action);
    case "run_shell":
      return executeRunShell(workspace, action, opts);
    case "run_tests":
      return executeRunTests(workspace, action, opts);
    case "finish":
      return executeFinish(workspace, action);
  }
}
