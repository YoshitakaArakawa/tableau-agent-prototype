import { Agent } from "@openai/agents";
import { getAgentModelConfig } from "../model/resolveModels";
import { loadPrompt } from "./promptLoader";

export function buildFieldSelectorAgent() {
  const { model, modelSettings } = getAgentModelConfig("field-selector");
  const options: any = {
    name: "field-selector",
    model,
    instructions: loadPrompt("field-selector"),
  };
  if (modelSettings && Object.keys(modelSettings).length > 0) {
    options.modelSettings = modelSettings;
  }
  return new Agent(options);
}
