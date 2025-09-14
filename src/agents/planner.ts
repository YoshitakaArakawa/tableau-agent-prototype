import { Agent } from "@openai/agents";
import { getModelForAgent } from "../model/resolveModels";
import { loadPrompt } from "./promptLoader";

export function buildPlannerAgent() {
  const model = getModelForAgent("vizql-builder");
  return new Agent({
    name: "vizql-builder",
    model,
    instructions: loadPrompt("vizql-builder"),
  });
}
