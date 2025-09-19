import { Agent } from "@openai/agents";
import { getAgentModelConfig } from "../model/resolveModels";
import { loadPrompt } from "./promptLoader";

export function buildQueryCompilerAgent() {
  const { model, modelSettings } = getAgentModelConfig("vizql-builder");
  const options: any = {
    name: "vizql-builder",
    model,
    maxTurns: 1,
    instructions: loadPrompt("vizql-builder"),
  };
  if (modelSettings && Object.keys(modelSettings).length > 0) {
    options.modelSettings = modelSettings;
  }
  return new Agent(options);
}
