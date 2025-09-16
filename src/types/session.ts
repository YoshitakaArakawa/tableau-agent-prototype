import type { AgentInputItem } from "@openai/agents";
import type { AnalysisPlan } from "../planning/schemas";

export type SessionState = {
  history: AgentInputItem[];
  analysisPlan?: AnalysisPlan;
  artifacts: string[];
};

export function createInitialSessionState(): SessionState {
  return { history: [], artifacts: [] };
}

