import type { OrchestratorEvent } from "../types/orchestrator";
import { safeEmit } from "../utils/events";

import { buildTriageAgent } from "../agents/triage";
import { buildFieldSelectorAgent } from "../agents/selector";
import { buildPlannerAgent } from "../agents/planner";

import { triagePhase } from "./triagePhase";
import { metadataPhase } from "./metadataPhase";
import { runFieldSelector } from "./selectorPhase";

import { planRunner } from "../planning/planRunner";
import { fetchRunner } from "../execution/fetchRunner";
import { summarizePhase } from "./summarizePhase";

export async function orchestrate(params: {
  message: string;
  datasourceLuid: string;
  limitHint?: number;
  onEvent?: (ev: OrchestratorEvent) => void;
}): Promise<{ reply: string; artifactPaths?: string[] }>
{
  const { message, datasourceLuid, limitHint, onEvent } = params;

  // Build agents
  const triage = buildTriageAgent();
  const selector = buildFieldSelectorAgent();
  const planner = buildPlannerAgent();

  // 1) Triage
  const tri = await triagePhase({ message, limitHint, triageAgent: triage, onEvent });
  if (tri.clarifyReply) {
    return { reply: tri.clarifyReply };
  }
  const decision = tri.decision || { needsData: true, needsMetadata: true, limit: limitHint };

  // 2) Metadata
  const meta = await metadataPhase({ datasourceLuid, needsMetadata: !!decision.needsMetadata, onEvent });
  if (meta.reply) {
    return { reply: meta.reply };
  }
  const normalizedFields = meta.normalizedFields || [];

  // 3) Field selection
  const sel = await runFieldSelector({
    enabled: true,
    message,
    normalizedFields,
    maxList: 3,
    agent: selector,
    onEvent,
  });
  const allowedFields = sel.allowedFields || [];
  if (!Array.isArray(allowedFields) || allowedFields.length === 0) {
    const reply = 'No suitable fields were selected. Please specify exact field names (e.g., a measure and a date field).';
    safeEmit(onEvent, { type: 'final', detail: { reply } });
    return { reply };
  }

  // 4) Planning
  const plan = await planRunner({
    message,
    datasourceLuid,
    allowedFields,
    queryCompiler: planner,
    onEvent,
  });
  if (!plan.payloadObj) {
    const reply = plan.error || 'Failed to generate a valid plan.';
    safeEmit(onEvent, { type: 'final', detail: { reply } });
    return { reply };
  }

  // 5) Fetch
  const fetched = await fetchRunner({ datasourceLuid, payloadObj: plan.payloadObj, onEvent });
  if (fetched.error) {
    const reply = fetched.error || 'Failed to fetch data.';
    safeEmit(onEvent, { type: 'final', detail: { reply } });
    return { reply };
  }

  const artifactPaths: string[] = [];
  if (fetched.artifactPath) artifactPaths.push(fetched.artifactPath);

  // 6) Summarize (uses CI by default if rows > 30)
  if (artifactPaths.length > 0) {
    const sum = await summarizePhase({ message, artifactPaths, onEvent });
    return { reply: sum.reply, artifactPaths };
  }

  const reply = fetched.fetchedSummary || 'No artifact available for summarization.';
  safeEmit(onEvent, { type: 'final', detail: { reply } });
  return { reply };
}

