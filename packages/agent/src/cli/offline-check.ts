import { lstat, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  LanguageModelV4FinishReason,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import type { LanguageModel } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import type { AgentEvent } from "../agent/events.js";
import { runAgent } from "../agent/loop.js";
import { loadAgentEnv } from "../config/env.js";
import { parseAction } from "../tools/actions.js";
import { LocalWorkspace } from "../workspace/local.js";
import { WorkspaceError } from "../workspace/types.js";

let passed = 0;
let failed = 0;
let skipped = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function skip(name: string, reason: string): void {
  skipped += 1;
  console.log(`SKIP  ${name} — ${reason}`);
}

const usage: LanguageModelV4Usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const finishStop: LanguageModelV4FinishReason = { unified: "stop", raw: undefined };
const finishToolCalls: LanguageModelV4FinishReason = { unified: "tool-calls", raw: undefined };

function textResult(text: string): LanguageModelV4GenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: finishStop,
    usage,
    warnings: [],
  };
}

function streamResult(
  parts: LanguageModelV4StreamPart[],
  reason: LanguageModelV4FinishReason = finishToolCalls,
): LanguageModelV4StreamResult {
  return {
    stream: convertArrayToReadableStream<LanguageModelV4StreamPart>([
      { type: "stream-start", warnings: [] },
      ...parts,
      { type: "finish", finishReason: reason, usage },
    ]),
  };
}

function toolCallPart(
  id: string,
  toolName: string,
  args: unknown,
): LanguageModelV4StreamPart {
  return {
    type: "tool-call",
    toolCallId: id,
    toolName,
    input: JSON.stringify(args),
  };
}

async function expectWorkspaceError(
  name: string,
  fn: () => Promise<unknown>,
  code?: string,
): Promise<void> {
  try {
    await fn();
    check(name, false, "expected WorkspaceError, nothing was thrown");
  } catch (error) {
    if (error instanceof WorkspaceError) {
      check(name, code === undefined || error.code === code, `code=${error.code}`);
    } else {
      check(name, false, `unexpected error: ${String(error)}`);
    }
  }
}

async function workspaceTests(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "kairo-ws-"));
  const ws = new LocalWorkspace({ root, maxOutputBytes: 1000, defaultTimeoutMs: 5000 });

  await ws.writeFile("src/hello.txt", "hello world");
  const read = await ws.readFile("src/hello.txt");
  check("workspace: write/read roundtrip", read.content === "hello world");

  await expectWorkspaceError(
    "workspace: rejects ../ traversal",
    () => ws.readFile("../escape.txt"),
    "TRAVERSAL",
  );
  await expectWorkspaceError(
    "workspace: rejects absolute path",
    () => ws.readFile("C:/Windows/win.ini"),
    "ABSOLUTE_PATH",
  );
  await expectWorkspaceError(
    "workspace: rejects traversal in write",
    () => ws.writeFile("a/../../escape.txt", "x"),
    "TRAVERSAL",
  );

  const listing = await ws.listFiles();
  check(
    "workspace: listFiles sees written file",
    listing.paths.includes("src/"),
    JSON.stringify(listing.paths),
  );

  const search = await ws.searchCode({ query: "hello world" });
  check(
    "workspace: searchCode finds literal",
    search.hits.some((hit) => hit.path === "src/hello.txt"),
    JSON.stringify(search.hits),
  );

  const slowCommand =
    process.platform === "win32"
      ? "ping -n 15 127.0.0.1 > NUL"
      : "sleep 10";
  const timeoutResult = await ws.exec(slowCommand, { timeoutMs: 500 });
  check("workspace: exec timeout kills process", timeoutResult.timedOut === true, JSON.stringify(timeoutResult));

  const truncCode = "process.stdout.write('x'.repeat(50000))";
  const truncCommand = `"${process.execPath}" -e "${truncCode}"`;
  const big = await ws.exec(truncCommand, {
    timeoutMs: 20_000,
    maxOutputBytes: 1000,
  });
  check(
    "workspace: exec output truncation",
    big.truncated === true && Buffer.byteLength(big.stdout) <= 1100,
    `stdoutBytes=${Buffer.byteLength(big.stdout)} truncated=${big.truncated} stderr=${big.stderr.slice(0, 200)}`,
  );

  process.env.KAIRO_TEST_SECRET = "super-secret-value";
  try {
    const secretCode = "process.stdout.write(process.env.KAIRO_TEST_SECRET ?? 'none')";
    const envLeak = await ws.exec(`"${process.execPath}" -e "${secretCode}"`, {
      timeoutMs: 20_000,
    });
    check(
      "workspace: child env excludes host secrets",
      envLeak.stdout.trim() === "none",
      `stdout=${JSON.stringify(envLeak.stdout)} stderr=${envLeak.stderr.slice(0, 200)}`,
    );
  } finally {
    delete process.env.KAIRO_TEST_SECRET;
  }

  const outsideDir = await mkdtemp(path.join(tmpdir(), "kairo-outside-"));
  const outsideFile = path.join(outsideDir, "secret.txt");
  await writeFile(outsideFile, "outside");
  const linkPath = path.join(root, "link-to-outside.txt");
  try {
    await symlink(outsideFile, linkPath);
    const stats = await lstat(linkPath);
    if (stats.isSymbolicLink()) {
      await expectWorkspaceError(
        "workspace: symlink escape blocked on read",
        () => ws.readFile("link-to-outside.txt"),
        "SYMLINK_ESCAPE",
      );
    } else {
      check("workspace: symlink escape blocked on read", false, "symlink not created");
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES") {
      // Windows without dev mode: try a directory junction instead (no privileges needed)
      try {
        const junctionPath = path.join(root, "link-escape");
        await symlink(outsideDir, junctionPath, "junction");
        await expectWorkspaceError(
          "workspace: symlink escape blocked on read (junction)",
          () => ws.readFile("link-escape/secret.txt"),
          "SYMLINK_ESCAPE",
        );
      } catch (junctionError) {
        skip(
          "workspace: symlink escape blocked on read",
          `symlink and junction both failed (${(junctionError as NodeJS.ErrnoException).code ?? junctionError})`,
        );
      }
    } else {
      check("workspace: symlink escape blocked on read", false, String(error));
    }
  }

  const missingCwd = await ws
    .exec(process.platform === "win32" ? "echo hi" : "echo hi", { cwd: "does-not-exist" })
    .then(
      () => null,
      (error: unknown) => error,
    );
  check(
    "workspace: exec rejects missing cwd",
    missingCwd instanceof WorkspaceError,
    String(missingCwd),
  );

  await rm(root, { recursive: true, force: true });
  await rm(outsideDir, { recursive: true, force: true });
}

function actionParsingTests(): void {
  check(
    "actions: parses plain JSON action",
    parseAction('{"tool":"run_tests"}')?.tool === "run_tests",
  );
  check(
    "actions: parses fenced JSON action",
    parseAction('Sure!\n```json\n{"tool":"list_files","path":"src"}\n```')?.tool ===
      "list_files",
  );
  check("actions: rejects prose", parseAction("I think we should list files now.") === null);
  check("actions: rejects unknown tool", parseAction('{"tool":"drop_database"}') === null);
}

async function nativeLoopTest(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "kairo-loop-"));
  const ws = new LocalWorkspace({ root });
  const events: AgentEvent[] = [];

  const plan = textResult(
    JSON.stringify({ approach: "write a file", steps: [{ id: "1", goal: "write hello.txt" }] }),
  );
  const planner = new MockLanguageModelV4({ doGenerate: [plan] });
  const executor = new MockLanguageModelV4({
    doStream: [
      streamResult([toolCallPart("c1", "write_file", { path: "hello.txt", content: "hi" })]),
      streamResult(
        [toolCallPart("c2", "finish", { success: true, summary: "created hello.txt" })],
        finishStop,
      ),
    ],
  });

  const env = { ...loadAgentEnv(), AGENT_MAX_REPLANS: 0, AGENT_TOOL_MODE: "native" as const };
  const result = await runAgent({
    workspace: ws,
    executorModel: executor as unknown as LanguageModel,
    plannerModel: planner as unknown as LanguageModel,
    task: "create hello.txt with hi",
    env,
    onEvent: (event) => events.push(event),
  });

  check(
    "loop(native): status SUCCEEDED",
    result.status === "SUCCEEDED",
    JSON.stringify(result.error),
  );
  const content = await ws.readFile("hello.txt").then((r) => r.content, () => null);
  check("loop(native): tool wrote the file", content === "hi", String(content));
  check(
    "loop(native): emitted plan/tool_call/tool_result/done",
    ["plan", "tool_call", "tool_result", "done"].every((type) =>
      events.some((e) => e.type === type),
    ),
    events.map((e) => e.type).join(","),
  );
  const doneEvent = events.find((e) => e.type === "done");
  check(
    "loop(native): done event carries summary",
    doneEvent?.type === "done" && doneEvent.summary.includes("hello.txt"),
    JSON.stringify(doneEvent),
  );

  await rm(root, { recursive: true, force: true });
}

async function stuckDetectionTest(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "kairo-stuck-"));
  const ws = new LocalWorkspace({ root });
  const events: AgentEvent[] = [];

  const plan = textResult(
    JSON.stringify({ approach: "keep trying", steps: [{ id: "1", goal: "whatever" }] }),
  );
  const planner = new MockLanguageModelV4({ doGenerate: [plan] });
  const repeatedCall = toolCallPart("c1", "write_file", {
    path: "same.txt",
    content: "same",
  });
  const executor = new MockLanguageModelV4({
    doStream: [streamResult([repeatedCall, repeatedCall, repeatedCall])],
  });

  const env = { ...loadAgentEnv(), AGENT_MAX_REPLANS: 0, AGENT_TOOL_MODE: "native" as const };
  const result = await runAgent({
    workspace: ws,
    executorModel: executor as unknown as LanguageModel,
    plannerModel: planner as unknown as LanguageModel,
    task: "get stuck",
    env,
    onEvent: (event) => events.push(event),
  });

  check(
    "loop(stuck): FAILED with STUCK code",
    result.status === "FAILED" && result.error?.code === "STUCK",
    JSON.stringify(result.error),
  );
  check(
    "loop(stuck): replan event not fired when maxReplans=0",
    !events.some((e) => e.type === "replan"),
  );

  await rm(root, { recursive: true, force: true });
}

async function jsonLoopTest(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "kairo-json-"));
  const ws = new LocalWorkspace({ root });
  const events: AgentEvent[] = [];

  const plan = textResult(
    JSON.stringify({ approach: "write then finish", steps: [{ id: "1", goal: "write a.txt" }] }),
  );
  const planner = new MockLanguageModelV4({ doGenerate: [plan] });
  const executor = new MockLanguageModelV4({
    doGenerate: [
      textResult('{"tool":"write_file","path":"a.txt","content":"json-mode"}'),
      textResult('{"tool":"finish","success":true,"summary":"wrote a.txt"}'),
    ],
  });

  const env = { ...loadAgentEnv(), AGENT_MAX_REPLANS: 0, AGENT_TOOL_MODE: "json" as const };
  const result = await runAgent({
    workspace: ws,
    executorModel: executor as unknown as LanguageModel,
    plannerModel: planner as unknown as LanguageModel,
    task: "create a.txt",
    env,
    onEvent: (event) => events.push(event),
  });

  check(
    "loop(json): status SUCCEEDED",
    result.status === "SUCCEEDED",
    JSON.stringify(result.error),
  );
  const content = await ws.readFile("a.txt").then((r) => r.content, () => null);
  check("loop(json): fallback path wrote the file", content === "json-mode", String(content));
  check(
    "loop(json): emitted tool_call events",
    events.some((e) => e.type === "tool_call" && e.name === "write_file"),
  );

  await rm(root, { recursive: true, force: true });
}

async function timeoutTest(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "kairo-timeout-"));
  const ws = new LocalWorkspace({ root });

  const slowPlanner = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const sleepMs = 2000;
      await Promise.race([
        new Promise((resolve) => setTimeout(resolve, sleepMs)),
        new Promise((_, reject) => {
          options.abortSignal?.addEventListener(
            "abort",
            () => {
              const abortError = new Error("aborted by test budget");
              abortError.name = "AbortError";
              reject(abortError);
            },
            { once: true },
          );
        }),
      ]);
      return textResult(JSON.stringify({ approach: "slow", steps: [{ id: "1", goal: "wait" }] }));
    },
  });
  const executor = new MockLanguageModelV4({
    doGenerate: [textResult("{}")],
  });

  const env = { ...loadAgentEnv(), AGENT_TIME_BUDGET_MS: 200 };
  const started = Date.now();
  const result = await runAgent({
    workspace: ws,
    executorModel: executor as unknown as LanguageModel,
    plannerModel: slowPlanner as unknown as LanguageModel,
    task: "timeout test",
    env,
  });

  check(
    "loop(timeout): FAILS with TIMEOUT within budget",
    result.status === "FAILED" &&
      result.error?.code === "TIMEOUT" &&
      Date.now() - started < 1500,
    JSON.stringify({ status: result.status, error: result.error, ms: Date.now() - started }),
  );

  await rm(root, { recursive: true, force: true });
}

async function main(): Promise<void> {
  console.log("offline checks (no LLM, no network)...\n");
  await workspaceTests();
  actionParsingTests();
  await nativeLoopTest();
  await stuckDetectionTest();
  await jsonLoopTest();
  await timeoutTest();
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
