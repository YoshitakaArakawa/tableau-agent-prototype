import { Agent } from "@openai/agents";
import { getModelForAgent } from "../model/resolveModels";
import { loadPrompt } from "./promptLoader";

export function buildTriageAgent() {
  const model = getModelForAgent("triage");
  return new Agent({
    name: "triage",
    model,
    instructions: loadPrompt("triage"),
  });
}
