import { run, user as userMsg, system as systemMsg, extractAllTextOutput, type AgentInputItem } from "@openai/agents";
import type { OrchestratorEvent, TriageDecision } from "../types/orchestrator";
import { safeEmit } from "../utils/events";

export async function triagePhase(params: {
  message: string;
  limitHint?: number;
  triageAgent: any;
  history?: AgentInputItem[];
  onEvent?: (ev: OrchestratorEvent) => void;
}): Promise<{ decision?: TriageDecision; clarifyReply?: string; triageRaw?: string; triageObj?: any }>
{
  const { message, limitHint, triageAgent, history = [], onEvent } = params;
  safeEmit(onEvent, { type: "triage:start", detail: { message, limitHint } });
  const started = Date.now();

  let res: any;
  try {
    const msgs: AgentInputItem[] = [
      ...history,
      userMsg(message),
      systemMsg(limitHint && Number.isFinite(limitHint) ? `limit hint: ${limitHint}` : ""),
    ];
    res = await run(triageAgent, msgs as any);
  } catch (e: any) {
    const msg = e?.message || String(e);
    safeEmit(onEvent, { type: 'triage:error', detail: { message: msg } });
    throw e;
  }

  const triageJsonTxt = (typeof (res as any)?.finalOutput === 'string' && (res as any).finalOutput)
    ? (res as any).finalOutput
    : extractAllTextOutput((res as any).output);

  let decision: TriageDecision = { needsData: true, needsMetadata: true };
  let triageObj: any = undefined;
  try { triageObj = JSON.parse(triageJsonTxt); } catch {}
  try {
    if (triageObj && typeof triageObj === "object") {
      if (typeof triageObj.needsData === "boolean") decision.needsData = triageObj.needsData;
      if (typeof triageObj.needsMetadata === "boolean") decision.needsMetadata = triageObj.needsMetadata;
      if (typeof triageObj.limit === "number") decision.limit = triageObj.limit;
    }
  } catch {}

  safeEmit(onEvent, { type: "triage:done", detail: { raw: triageJsonTxt, decision, durationMs: Date.now() - started } });

  // Optional: allow the triage prompt to request clarification explicitly
  try {
    if (triageObj && triageObj.needsClarification === true && typeof triageObj.message === 'string') {
      const reply = String(triageObj.message);
      safeEmit(onEvent, { type: "clarify:request", detail: { text: reply, durationMs: Date.now() - started } });
      return { clarifyReply: reply, triageRaw: triageJsonTxt, triageObj };
    }
  } catch {}

  return { decision, triageRaw: triageJsonTxt, triageObj };
}
