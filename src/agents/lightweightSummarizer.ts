import { Agent } from "@openai/agents";
import { getAgentModelConfig } from "../model/resolveModels";
import { loadPrompt } from "./promptLoader";

export function buildLightweightSummarizerAgent() {
  const { model, modelSettings } = getAgentModelConfig("lightweight-summarizer");
  const options: any = {
    name: "lightweight-summarizer",
    model,
    maxTurns: 1,
    instructions: loadPrompt("lightweight-summarizer"),
  };
  if (modelSettings && Object.keys(modelSettings).length > 0) {
    options.modelSettings = modelSettings;
  }
  return new Agent(options);
}
