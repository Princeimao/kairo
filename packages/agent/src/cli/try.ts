import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAgent, type AgentResult } from "../agent/loop.js";
import type { AgentEvent } from "../agent/events.js";
import { loadAgentEnv } from "../config/env.js";
import { createModels } from "../models.js";
import { LocalWorkspace } from "../workspace/local.js";

interface CliArgs {
  task: string;
  workdir?: string;
  keep: boolean;
  toolMode?: "native" | "json";
  maxSteps?: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: string[] = [];
  const cli: CliArgs = { task: "", keep: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--keep") {
      cli.keep = true;
    } else if (arg === "--workdir") {
      cli.workdir = argv[++i];
    } else if (arg === "--tool-mode") {
      const mode = argv[++i];
      if (mode !== "native" && mode !== "json") {
        throw new Error(`--tool-mode must be native or json, got ${mode}`);
      }
      cli.toolMode = mode;
    } else if (arg === "--max-steps") {
      cli.maxSteps = Number(argv[++i]);
      if (!Number.isFinite(cli.maxSteps) || cli.maxSteps <= 0) {
        throw new Error("--max-steps must be a positive number");
      }
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown flag: ${arg}`);
    } else {
      args.push(arg);
    }
  }
  cli.task = args.join(" ").trim();
  if (!cli.task) {
    throw new Error('usage: npm run agent:try -w packages/agent -- "<task>" [--workdir DIR] [--tool-mode native|json] [--max-steps N] [--keep]');
  }
  return cli;
}

function stamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function printEvent(event: AgentEvent): void {
  switch (event.type) {
    case "plan":
      console.log(`[${stamp()}] plan        ${event.plan.approach}`);
      for (const step of event.plan.steps) {
        console.log(`               ${step.id}. ${step.goal}`);
      }
      break;
    case "text": {
      const text = event.text.replace(/\s+/g, " ").trim();
      if (text.length > 0) {
        console.log(`[${stamp()}] text        ${text.slice(0, 300)}`);
      }
      break;
    }
    case "tool_call": {
      const args = JSON.stringify(event.args ?? {});
      console.log(
        `[${stamp()}] tool_call   ${event.name} ${args.length > 300 ? args.slice(0, 300) + "…" : args}`,
      );
      break;
    }
    case "tool_result": {
      const preview = JSON.stringify(event.output ?? {});
      console.log(
        `[${stamp()}] tool_result ${event.ok ? "ok  " : "FAIL"} ${event.name} (${event.durationMs}ms) ${
          preview.length > 200 ? preview.slice(0, 200) + "…" : preview
        }`,
      );
      break;
    }
    case "replan":
      console.log(`[${stamp()}] replan      ${event.reason} → ${event.plan.approach}`);
      break;
    case "error":
      console.log(`[${stamp()}] error       ${event.code}: ${event.message}`);
      break;
    case "done": {
      const seconds = (event.durationMs / 1000).toFixed(1);
      console.log(
        `[${stamp()}] done        ${event.status} in ${seconds}s (${event.steps} steps)`,
      );
      if (event.summary) console.log(`               ${event.summary}`);
      break;
    }
  }
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const env = loadAgentEnv();
  const models = createModels(env);

  let workdir = cli.workdir;
  let createdTemp = false;
  if (!workdir) {
    workdir = await mkdtemp(path.join(tmpdir(), "kairo-agent-try-"));
    createdTemp = true;
  }

  const workspace = new LocalWorkspace({
    root: workdir,
    maxOutputBytes: env.AGENT_MAX_TOOL_OUTPUT_BYTES,
    defaultTimeoutMs: env.AGENT_TOOL_TIMEOUT_MS,
    maxReadBytes: env.AGENT_MAX_READ_BYTES,
    maxWriteBytes: env.AGENT_MAX_WRITE_BYTES,
  });

  console.log(`workspace: ${workdir}`);
  console.log(
    `models: planner=${env.AGENT_PLANNER_MODEL} executor=${env.AGENT_EXECUTOR_MODEL} mode=${cli.toolMode ?? env.AGENT_TOOL_MODE}`,
  );
  console.log(`task: ${cli.task}`);
  console.log("");

  let result: AgentResult;
  try {
    result = await runAgent({
      workspace,
      executorModel: models.executor,
      plannerModel: models.planner,
      task: cli.task,
      toolMode: cli.toolMode,
      env,
      maxSteps: cli.maxSteps,
      onEvent: printEvent,
    });
  } finally {
    if (createdTemp && !cli.keep) {
      // leave cleanup best-effort; files are tiny
    }
  }

  console.log("");
  console.log(
    `result: ${result.status} — ${result.summary} (steps=${result.steps}, ${(result.durationMs / 1000).toFixed(1)}s)`,
  );

  if (createdTemp && !cli.keep) {
    await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
  }

  process.exitCode = result.status === "SUCCEEDED" ? 0 : 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = message.includes("NEBIUS_API_KEY") ? 2 : 1;
});
