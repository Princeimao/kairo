import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { loadAgentEnv, requireApiKey, type AgentEnv } from "./config/env.js";

export interface AgentModels {
  planner: LanguageModel;
  executor: LanguageModel;
  env: AgentEnv;
}

export function createProvider(env: AgentEnv = loadAgentEnv()) {
  return createOpenAICompatible({
    name: "nebius",
    baseURL: env.NEBIUS_BASE_URL.replace(/\/+$/, ""),
    apiKey: requireApiKey(env),
    supportsStructuredOutputs: true,
  });
}

export function createPlannerModel(env: AgentEnv = loadAgentEnv()): LanguageModel {
  return createProvider(env).languageModel(env.AGENT_PLANNER_MODEL);
}

export function createExecutorModel(env: AgentEnv = loadAgentEnv()): LanguageModel {
  return createProvider(env).languageModel(env.AGENT_EXECUTOR_MODEL);
}

export function createModels(env: AgentEnv = loadAgentEnv()): AgentModels {
  return {
    planner: createPlannerModel(env),
    executor: createExecutorModel(env),
    env,
  };
}
