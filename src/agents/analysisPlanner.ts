import { Agent } from "@openai/agents";
import { getAgentModelConfig } from "../model/resolveModels";
import { loadPrompt } from "./promptLoader";

export function buildAnalysisPlannerAgent() {
  const { model, modelSettings } = getAgentModelConfig("analysis-planner");
  const options: any = {
    name: "analysis-planner",
    model,
    maxTurns: 1,
    instructions: loadPrompt("analysis-planner"),
  };
  if (modelSettings && Object.keys(modelSettings).length > 0) {
    options.modelSettings = modelSettings;
  }
  return new Agent(options);
}

