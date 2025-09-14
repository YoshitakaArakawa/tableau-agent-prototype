import { Agent } from "@openai/agents";
import { getModelForAgent } from "../model/resolveModels";
import { loadPrompt } from "./promptLoader";

export function buildFieldSelectorAgent() {
  const model = getModelForAgent("field-selector");
  return new Agent({
    name: "field-selector",
    model,
    instructions: loadPrompt("field-selector"),
  });
}

