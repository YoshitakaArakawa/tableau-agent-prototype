import { run, user as userMsg, system as systemMsg, extractAllTextOutput, type AgentInputItem } from "@openai/agents";
import { AnalysisPlannerOutput, type AnalysisPlan } from "./schemas";
import { safeEmit } from "../utils/events";

export async function planRunner(params: {
  message: string;
  datasourceLuid: string;
  allowedFields: Array<{ fieldCaption: string; function?: string }>;
  analysisPlanner: any;
  history?: AgentInputItem[];
  triageContext?: { brief?: any; briefNatural?: string; requiredFields?: string[]; filterHints?: any[] } | null;
  onEvent?: (ev: { type: string; detail?: any }) => void;
}): Promise<{ analysisPlan?: AnalysisPlan; error?: string }>
{
  const {
    message,
    datasourceLuid,
    allowedFields,
    analysisPlanner,
    history = [],
    triageContext,
    onEvent,
  } = params;

  safeEmit(onEvent as any, { type: "plan:start" });
  safeEmit(onEvent as any, {
    type: "plan:analysis:start",
    detail: {
      allowedFields: Array.isArray(allowedFields) ? allowedFields.length : 0,
    },
  });

  const started = Date.now();
  const baseMsgs = [
    ...history,
    userMsg(message),
    systemMsg(`datasourceLuid=${datasourceLuid}`),
    systemMsg(`ALLOWED_FIELDS_JSON=${JSON.stringify(allowedFields || [])}`),
  ] as any[];

  if (triageContext?.brief) {
    baseMsgs.push(systemMsg(`TRIAGE_BRIEF_JSON=${JSON.stringify(triageContext.brief)}`));
  }
  if (triageContext?.briefNatural) {
    baseMsgs.push(systemMsg(`TRIAGE_BRIEF_TEXT=${triageContext.briefNatural}`));
  }
  if (Array.isArray(triageContext?.requiredFields) && triageContext.requiredFields.length) {
    baseMsgs.push(systemMsg(`TRIAGE_REQUIRED_FIELDS_JSON=${JSON.stringify(triageContext.requiredFields)}`));
  }
  if (Array.isArray(triageContext?.filterHints) && triageContext.filterHints.length) {
    baseMsgs.push(systemMsg(`TRIAGE_FILTER_HINTS_JSON=${JSON.stringify(triageContext.filterHints)}`));
  }

  let analysisText = "";
  try {
    const res = await run(analysisPlanner, baseMsgs);
    analysisText =
      typeof (res as any)?.finalOutput === "string" && (res as any).finalOutput
        ? (res as any).finalOutput
        : extractAllTextOutput((res as any).output);
  } catch (e: any) {
    const error = e?.message || String(e);
    safeEmit(onEvent as any, { type: "plan:analysis:error", detail: { message: error, durationMs: Date.now() - started } });
    safeEmit(onEvent as any, { type: "plan:error", detail: { message: error, durationMs: Date.now() - started } });
    return { error };
  }

  let parsed: any = null;
  try { parsed = JSON.parse(analysisText); } catch {}
  const validation = AnalysisPlannerOutput.safeParse(parsed);
  if (!validation.success) {
    const error = validation.error?.issues?.[0]?.message || "analysis_plan_validation_failed";
    const detail = { message: error, durationMs: Date.now() - started, issues: validation.error.issues };
    safeEmit(onEvent as any, { type: "plan:analysis:error", detail });
    safeEmit(onEvent as any, { type: "plan:error", detail });
    return { error };
  }

  const analysisPlan = validation.data.analysis_plan;
  const steps = Array.isArray(analysisPlan?.steps) ? analysisPlan.steps.length : 0;
  const overview = analysisPlan?.overview;
  const duration = Date.now() - started;

  safeEmit(onEvent as any, {
    type: "plan:analysis:done",
    detail: {
      durationMs: duration,
      steps,
      overview,
    },
  });

  safeEmit(onEvent as any, {
    type: "plan:done",
    detail: {
      analysis_plan: {
        steps,
        overview,
      },
      durationMs: duration,
    },
  });

  return { analysisPlan };
}
