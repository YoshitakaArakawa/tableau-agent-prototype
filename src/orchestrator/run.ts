import { user as userMsg, assistant as assistantMsg } from "@openai/agents";
import type { OrchestratorEvent } from "../types/orchestrator";
import { safeEmit } from "../utils/events";

import { buildTriageAgent } from "../agents/triage";
import { buildFieldSelectorAgent } from "../agents/selector";

import { metadataPhase } from "./metadataPhase";
import { triagePhase } from "./triagePhase";
import { runFieldSelector } from "./selectorPhase";

import { fetchRunner } from "../execution/fetchRunner";
import { summarizePhase } from "./summarizePhase";
import type { SessionState } from "../types/session";
import { createInitialSessionState } from "../types/session";

export async function orchestrate(params: {
  message: string;
  datasourceLuid: string;
  onEvent?: (ev: OrchestratorEvent) => void;
  state?: SessionState;
  abortSignal?: AbortSignal;
}): Promise<{ reply: string; artifactPaths?: string[]; nextState: SessionState }>
{
  const { message, datasourceLuid, onEvent, state, abortSignal } = params;

  const triage = buildTriageAgent();
  const selector = buildFieldSelectorAgent();

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

  const isAborted = () => Boolean(abortSignal?.aborted);
  const finishCancelled = () => {
    const reply = "Run stopped by user.";
    safeEmit(onEvent as any, { type: "final", detail: { reply, cancelled: true } });
    const assistantTurn = assistantMsg(reply);
    const nextState: SessionState = {
      ...workingState,
      history: [...workingState.history, assistantTurn],
    };
    return { reply, artifactPaths: [], nextState };
  };

  if (isAborted()) {
    return finishCancelled();
  }


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
    maxList: 10,
    agent: selector,
    history: historyBefore,
    onEvent,
  });

  if (isAborted()) {
    return finishCancelled();
  }


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

  const analysisPlan = workingState.triageContext?.analysisPlan;
  workingState = {
    ...workingState,
    analysisPlan: analysisPlan ?? workingState.analysisPlan,
  };

  if (analysisPlan) {
    safeEmit(onEvent as any, {
      type: "plan:done",
      detail: {
        analysis_plan: {
          steps: Array.isArray(analysisPlan.steps) ? analysisPlan.steps.length : 0,
          overview: analysisPlan.overview,
        },
        durationMs: 0,
      },
    });
  }

  if (isAborted()) {
    return finishCancelled();
  }


  const fetched = await fetchRunner({
    datasourceLuid,
    message,
    analysisPlan: analysisPlan ?? workingState.analysisPlan,
    allowedFields,
    triageContext: workingState.triageContext,
    fieldAliases: allowedFieldsResult.suggestedAliases,
    onEvent,
    abortSignal,
  });

  if (fetched.cancelled) {
    return finishCancelled();
  }

  if (isAborted()) {
    return finishCancelled();
  }

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
    if (isAborted()) {
      return finishCancelled();
    }

    const sum = await summarizePhase({
      message,
      artifactPaths,
      analysisContext: workingState.analysisPlan ? { analysisPlan: workingState.analysisPlan } : undefined,
      onEvent,
      abortSignal,
    });
    if (sum.cancelled) {
      return finishCancelled();
    }
    const summaryReply = sum.reply ?? "";
    const assistantTurn = assistantMsg(summaryReply);
    const nextState: SessionState = {
      ...workingState,
      history: [...workingState.history, assistantTurn],
    };
    return { reply: summaryReply, artifactPaths, nextState };
  }

  if (isAborted()) {
    return finishCancelled();
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

