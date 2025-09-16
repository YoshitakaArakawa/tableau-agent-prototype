import { user as userMsg, assistant as assistantMsg } from "@openai/agents";
import type { OrchestratorEvent } from "../types/orchestrator";
import { safeEmit } from "../utils/events";

import { buildTriageAgent } from "../agents/triage";
import { buildFieldSelectorAgent } from "../agents/selector";
import { buildAnalysisPlannerAgent } from "../agents/analysisPlanner";
import { buildPlannerAgent } from "../agents/planner";

import { triagePhase } from "./triagePhase";
import { metadataPhase } from "./metadataPhase";
import { runFieldSelector } from "./selectorPhase";

import { planRunner } from "../planning/planRunner";
import { fetchRunner } from "../execution/fetchRunner";
import { summarizePhase } from "./summarizePhase";
import type { SessionState } from "../types/session";
import { createInitialSessionState } from "../types/session";

export async function orchestrate(params: {
  message: string;
  datasourceLuid: string;
  limitHint?: number;
  onEvent?: (ev: OrchestratorEvent) => void;
  state?: SessionState;
}): Promise<{ reply: string; artifactPaths?: string[]; nextState: SessionState }>
{
  const { message, datasourceLuid, limitHint, onEvent, state } = params;

  // Build agents
  const triage = buildTriageAgent();
  const selector = buildFieldSelectorAgent();
  const analysisPlannerAgent = buildAnalysisPlannerAgent();
  const queryCompilerAgent = buildPlannerAgent();

  const baseState = state
    ? { history: [...state.history], analysisPlan: state.analysisPlan, artifacts: [...state.artifacts] }
    : createInitialSessionState();
  const historyBefore = [...baseState.history];
  const userTurn = userMsg(message);
  let workingState: SessionState = { ...baseState, history: [...historyBefore, userTurn] };

  // 1) Triage
  const tri = await triagePhase({ message, limitHint, triageAgent: triage, history: historyBefore, onEvent });
  if (tri.clarifyReply) {
    const assistantTurn = assistantMsg(tri.clarifyReply);
    const nextState: SessionState = { ...workingState, analysisPlan: baseState.analysisPlan, artifacts: baseState.artifacts, history: [...workingState.history, assistantTurn] };
    return { reply: tri.clarifyReply, artifactPaths: [], nextState };
  }
  const decision = tri.decision || { needsData: true, needsMetadata: true, limit: limitHint };

  // 2) Metadata
  const meta = await metadataPhase({ datasourceLuid, needsMetadata: !!decision.needsMetadata, onEvent });
  if (meta.reply) {
    const assistantTurn = assistantMsg(meta.reply);
    const nextState: SessionState = { ...workingState, history: [...workingState.history, assistantTurn] };
    return { reply: meta.reply, artifactPaths: [], nextState };
  }
  const normalizedFields = meta.normalizedFields || [];

  // 3) Field selection
  const sel = await runFieldSelector({
    enabled: true,
    message,
    normalizedFields,
    maxList: 3,
    agent: selector,
    history: historyBefore,
    onEvent,
  });
  const allowedFields = sel.allowedFields || [];
  if (!Array.isArray(allowedFields) || allowedFields.length === 0) {
    const reply = 'No suitable fields were selected. Please specify exact field names (e.g., a measure and a date field).';
    safeEmit(onEvent, { type: 'final', detail: { reply } });
    const assistantTurn = assistantMsg(reply);
    const nextState: SessionState = { ...workingState, history: [...workingState.history, assistantTurn] };
    return { reply, artifactPaths: [], nextState };
  }

  // 4) Planning
  const triageContext = tri.triageObj && typeof tri.triageObj === 'object'
    ? {
        brief: (tri.triageObj as any).brief,
        briefNatural: typeof (tri.triageObj as any).briefNatural === 'string' ? (tri.triageObj as any).briefNatural : undefined,
      }
    : undefined;

  const plan = await planRunner({
    message,
    datasourceLuid,
    allowedFields,
    analysisPlanner: analysisPlannerAgent,
    queryCompiler: queryCompilerAgent,
    history: historyBefore,
    triageContext,
    onEvent,
  });
  if (!plan.payloadObj) {
    const reply = plan.error || 'Failed to generate a valid plan.';
    safeEmit(onEvent, { type: 'final', detail: { reply } });
    const assistantTurn = assistantMsg(reply);
    const nextState: SessionState = { ...workingState, history: [...workingState.history, assistantTurn] };
    return { reply, artifactPaths: [], nextState };
  }
  if (plan.analysisPlan) {
    workingState = { ...workingState, analysisPlan: plan.analysisPlan };
  }

  // 5) Fetch
  const fetched = await fetchRunner({ datasourceLuid, payloadObj: plan.payloadObj, onEvent });
  if (fetched.error) {
    const reply = fetched.error || 'Failed to fetch data.';
    safeEmit(onEvent, { type: 'final', detail: { reply } });
    const assistantTurn = assistantMsg(reply);
    const nextState: SessionState = { ...workingState, history: [...workingState.history, assistantTurn] };
    return { reply, artifactPaths: [], nextState };
  }

  const artifactPaths: string[] = [];
  if (fetched.artifactPath) {
    artifactPaths.push(fetched.artifactPath);
    workingState = { ...workingState, artifacts: [...workingState.artifacts, fetched.artifactPath] };
  }

  // 6) Summarize (uses CI by default if rows > 30)
  if (artifactPaths.length > 0) {
    const sum = await summarizePhase({
      message,
      artifactPaths,
      analysisContext: workingState.analysisPlan ? { analysisPlan: workingState.analysisPlan } : undefined,
      onEvent,
    });
    const assistantTurn = assistantMsg(sum.reply);
    const nextState: SessionState = { ...workingState, history: [...workingState.history, assistantTurn] };
    return { reply: sum.reply, artifactPaths, nextState };
  }

  const reply = fetched.fetchedSummary || 'No artifact available for summarization.';
  safeEmit(onEvent, { type: 'final', detail: { reply } });
  const assistantTurn = assistantMsg(reply);
  const nextState: SessionState = { ...workingState, history: [...workingState.history, assistantTurn] };
  return { reply, artifactPaths, nextState };
}
