import type { FinishInput } from "../tools/schemas.js";

export interface PlanStep {
  id: string;
  goal: string;
}

export interface Plan {
  approach: string;
  steps: PlanStep[];
}

export type AgentEvent =
  | { type: "plan"; plan: Plan }
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | {
      type: "tool_result";
      id: string;
      name: string;
      ok: boolean;
      output: unknown;
      durationMs: number;
    }
  | { type: "replan"; reason: string; plan: Plan }
  | { type: "error"; code: string; message: string }
  | {
      type: "done";
      status: "SUCCEEDED" | "FAILED" | "CANCELLED";
      summary: string;
      steps: number;
      durationMs: number;
      finish?: FinishInput;
      error?: { code: string; message: string };
    };

export type AgentEventListener = (event: AgentEvent) => void;

export function isTerminalEvent(event: AgentEvent): boolean {
  return event.type === "done";
}
