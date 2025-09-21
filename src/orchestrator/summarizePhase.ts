import type { OrchestratorEvent } from "../types/orchestrator";
import { safeEmit } from "../utils/events";
import { summarize } from "../summary/run";

export async function summarizePhase(params: {
  message: string;
  artifactPaths: string[];
  analysisContext?: any;
  onEvent?: (ev: OrchestratorEvent) => void;
  abortSignal?: AbortSignal;
}): Promise<{ reply?: string; cancelled?: boolean }>
{
  const { message, artifactPaths, analysisContext, onEvent, abortSignal } = params;
  if (abortSignal?.aborted) {
    return { cancelled: true };
  }
  safeEmit(onEvent, { type: "summarize:start", detail: { artifacts: artifactPaths } });
  const started = Date.now();
  const result = await summarize({
    message,
    artifactPaths,
    analysisContext,
    onEvent,
    abortSignal,
  });
  if (result.cancelled) {
    return { cancelled: true };
  }
  const reply = result.reply ?? "";
  safeEmit(onEvent, { type: "final", detail: { reply, durationMs: Date.now() - started } });
  return { reply };
}
