import { z } from "zod";

export const listFilesInput = z.object({
  path: z
    .string()
    .optional()
    .describe("Directory relative to the workspace root. Omit for the root."),
});

export const readFileInput = z.object({
  path: z.string().describe("File path relative to the workspace root."),
  startLine: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("1-based first line to return. Omit to start at the top."),
  endLine: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("1-based last line to return. Omit to read to the end."),
});

export const writeFileInput = z.object({
  path: z.string().describe("File path relative to the workspace root."),
  content: z.string().describe("Full new file content."),
});

export const searchCodeInput = z.object({
  query: z.string().describe("Text or pattern to search for."),
  path: z.string().optional().describe("Subdirectory to search in."),
  isRegex: z
    .boolean()
    .optional()
    .describe("Treat query as a regular expression. Default: literal."),
});

export const runShellInput = z.object({
  command: z.string().describe("Shell command to run in the workspace."),
  cwd: z.string().optional().describe("Working directory relative to the root."),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(120_000)
    .optional()
    .describe("Kill the command after this many milliseconds."),
});

export const runTestsInput = z.object({
  command: z
    .string()
    .optional()
    .describe(
      "Override the test command. Default: npm test when package.json exists, else python -m pytest -q.",
    ),
});

export const finishInput = z.object({
  success: z.boolean().describe("Whether the task completed successfully."),
  summary: z
    .string()
    .describe(
      "Short human-readable summary of what was done, files created/changed, and test results.",
    ),
  testResults: z
    .string()
    .optional()
    .describe("Optional brief note about test/lint outcomes."),
});

export type ListFilesInput = z.infer<typeof listFilesInput>;
export type ReadFileInput = z.infer<typeof readFileInput>;
export type WriteFileInput = z.infer<typeof writeFileInput>;
export type SearchCodeInput = z.infer<typeof searchCodeInput>;
export type RunShellInput = z.infer<typeof runShellInput>;
export type RunTestsInput = z.infer<typeof runTestsInput>;
export type FinishInput = z.infer<typeof finishInput>;
