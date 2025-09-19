import type { AgentInputItem } from "@openai/agents";
import type { AnalysisPlan } from "../planning/schemas";
import type { NormalizedField } from "../utils/metadataCache";
import type { TriageContext } from "./orchestrator";

export type SessionState = {
  history: AgentInputItem[];
  analysisPlan?: AnalysisPlan;
  artifacts: string[];
  metadata?: {
    datasourceLuid: string;
    fields: NormalizedField[];
  };
  triageContext?: TriageContext;
};

export function createInitialSessionState(): SessionState {
  return { history: [], artifacts: [] };
}
