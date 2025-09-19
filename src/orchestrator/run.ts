import { user as userMsg, assistant as assistantMsg } from "@openai/agents";
import type { OrchestratorEvent } from "../types/orchestrator";
import { safeEmit } from "../utils/events";

import { buildTriageAgent } from "../agents/triage";
import { buildFieldSelectorAgent } from "../agents/selector";
import { buildAnalysisPlannerAgent } from "../agents/analysisPlanner";

import { metadataPhase } from "./metadataPhase";
import { triagePhase } from "./triagePhase";
import { runFieldSelector } from "./selectorPhase";

import { planRunner } from "../planning/planRunner";
import { fetchRunner } from "../execution/fetchRunner";
import { summarizePhase } from "./summarizePhase";
import type { SessionState } from "../types/session";
import { createInitialSessionState } from "../types/session";

export async function orchestrate(params: {
  message: string;
  datasourceLuid: string;
  onEvent?: (ev: OrchestratorEvent) => void;
  state?: SessionState;
}): Promise<{ reply: string; artifactPaths?: string[]; nextState: SessionState }>
{
  const { message, datasourceLuid, onEvent, state } = params;

  const triage = buildTriageAgent();
  const selector = buildFieldSelectorAgent();
  const analysisPlannerAgent = buildAnalysisPlannerAgent();

  const baseState = state
    ? {
        history: [...state.history],
        analysisPlan: state.analysisPlan,
        artifacts: [...state.artifacts],
        metadata: state.metadata,
        triageContext: state.triageContext,
      }
    : {
        ...createInitialSessionState(),
      };

  const historyBefore = [...baseState.history];
  const userTurn = userMsg(message);
  let workingState: SessionState = {
    history: [...historyBefore, userTurn],
    analysisPlan: baseState.analysisPlan,
    artifacts: [...baseState.artifacts],
    metadata: baseState.metadata,
    triageContext: baseState.triageContext,
  };

  const cachedFields = baseState.metadata && baseState.metadata.datasourceLuid === datasourceLuid
    ? baseState.metadata.fields
    : undefined;

  const meta = await metadataPhase({ datasourceLuid, existingFields: cachedFields, onEvent });
  if (meta.reply) {
    const reply = meta.reply;
    const assistantTurn = assistantMsg(reply);
    const nextState: SessionState = {
      ...workingState,
      history: [...workingState.history, assistantTurn],
    };
    return { reply, artifactPaths: [], nextState };
  }
  const normalizedFields = meta.normalizedFields ?? [];
  workingState = {
    ...workingState,
    metadata: { datasourceLuid, fields: normalizedFields },
  };

  const tri = await triagePhase({
    message,
    triageAgent: triage,
    normalizedFields,
    history: historyBefore,
    onEvent,
  });

  workingState = {
    ...workingState,
    triageContext: tri.context,
  };

  if (tri.clarifyReply) {
    const reply = tri.clarifyReply;
    const assistantTurn = assistantMsg(reply);
    const nextState: SessionState = {
      ...workingState,
      history: [...workingState.history, assistantTurn],
    };
    return { reply, artifactPaths: [], nextState };
  }

  const allowedFieldsResult = await runFieldSelector({
    enabled: true,
    message,
    normalizedFields,
    requiredFields: tri.context?.requiredFields,
    filterHints: tri.context?.filterHints,
    maxList: 3,
    agent: selector,
    history: historyBefore,
    onEvent,
  });

  if (allowedFieldsResult.clarify) {
    const detail = {
      text: allowedFieldsResult.clarify.message,
      candidates: allowedFieldsResult.clarify.candidates,
    };
    safeEmit(onEvent, { type: "clarify:request", detail });
    const reply = allowedFieldsResult.clarify.message;
    const assistantTurn = assistantMsg(reply);
    const nextState: SessionState = {
      ...workingState,
      history: [...workingState.history, assistantTurn],
    };
    return { reply, artifactPaths: [], nextState };
  }

  const allowedFields = allowedFieldsResult.allowedFields || [];
  if (!Array.isArray(allowedFields) || allowedFields.length === 0) {
    const reply = "No suitable fields were selected. Please specify exact field names (e.g., a measure and any required filters).";
    safeEmit(onEvent, { type: "final", detail: { reply } });
    const assistantTurn = assistantMsg(reply);
    const nextState: SessionState = {
      ...workingState,
      history: [...workingState.history, assistantTurn],
    };
    return { reply, artifactPaths: [], nextState };
  }

  const plan = await planRunner({
    message,
    datasourceLuid,
    allowedFields,
    analysisPlanner: analysisPlannerAgent,
    history: historyBefore,
    triageContext: workingState.triageContext,
    onEvent,
  });

  if (!plan.analysisPlan) {
    const reply = plan.error || "Failed to generate a valid plan.";
    safeEmit(onEvent, { type: "final", detail: { reply } });
    const assistantTurn = assistantMsg(reply);
    const nextState: SessionState = {
      ...workingState,
      history: [...workingState.history, assistantTurn],
    };
    return { reply, artifactPaths: [], nextState };
  }

  workingState = { ...workingState, analysisPlan: plan.analysisPlan };

  const fetched = await fetchRunner({
    datasourceLuid,
    message,
    analysisPlan: plan.analysisPlan,
    allowedFields,
    triageContext: workingState.triageContext,
    fieldAliases: allowedFieldsResult.suggestedAliases,
    onEvent,
  });

  if (fetched.error) {
    const reply = fetched.error || "Failed to fetch data.";
    safeEmit(onEvent, { type: "final", detail: { reply } });
    const assistantTurn = assistantMsg(reply);
    const nextState: SessionState = {
      ...workingState,
      history: [...workingState.history, assistantTurn],
    };
    return { reply, artifactPaths: [], nextState };
  }

  const artifactPaths: string[] = [];
  if (fetched.artifactPath) {
    artifactPaths.push(fetched.artifactPath);
    workingState = { ...workingState, artifacts: [...workingState.artifacts, fetched.artifactPath] };
  }

  if (artifactPaths.length > 0) {
    const sum = await summarizePhase({
      message,
      artifactPaths,
      analysisContext: workingState.analysisPlan ? { analysisPlan: workingState.analysisPlan } : undefined,
      onEvent,
    });
    const assistantTurn = assistantMsg(sum.reply);
    const nextState: SessionState = {
      ...workingState,
      history: [...workingState.history, assistantTurn],
    };
    return { reply: sum.reply, artifactPaths, nextState };
  }

  const reply = fetched.fetchedSummary || "No artifact available for summarization.";
  safeEmit(onEvent, { type: "final", detail: { reply } });
  const assistantTurn = assistantMsg(reply);
  const nextState: SessionState = {
    ...workingState,
    history: [...workingState.history, assistantTurn],
  };
  return { reply, artifactPaths, nextState };
}
