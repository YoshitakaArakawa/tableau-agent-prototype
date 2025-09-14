import { Agent } from "@openai/agents";
import { getModelForAgent } from "../model/resolveModels";
import { loadPrompt } from "./promptLoader";
import { appendAnalysisLog } from "../utils/logger";

export function buildTriageAgent() {
  const model = getModelForAgent("triage");
  try { appendAnalysisLog(`[agent] triage model=${model}`); } catch {}
  return new Agent({
    name: "triage",
    model,
    instructions: loadPrompt("triage"),
  });
}
