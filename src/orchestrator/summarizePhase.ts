import type { OrchestratorEvent } from "../types/orchestrator";
import { safeEmit } from "../utils/events";
import { summarize } from "../summary/run";

export async function summarizePhase(params: {
  message: string;
  artifactPaths: string[];
  analysisContext?: any;
  onEvent?: (ev: OrchestratorEvent) => void;
}): Promise<{ reply: string }>
{
  const { message, artifactPaths, analysisContext, onEvent } = params;
  safeEmit(onEvent, { type: "summarize:start", detail: { artifacts: artifactPaths } });
  const { reply } = await summarize({ message, artifactPaths, analysisContext });
  safeEmit(onEvent, { type: "final", detail: { reply } });
  return { reply };
}

