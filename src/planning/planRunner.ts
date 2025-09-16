import { run, user as userMsg, system as systemMsg, extractAllTextOutput, type AgentInputItem } from "@openai/agents";
import {
  PlannerPayload,
  AnalysisPlannerOutput,
  type PlanningPayload,
  type AnalysisPlan,
  type AnalysisPlannerOutputType,
} from "./schemas";
import { safeEmit } from "../utils/events";

type AgentLike = any;

export async function planRunner(params: {
  message: string;
  datasourceLuid: string;
  allowedFields: Array<{ fieldCaption: string; function?: string }>;
  analysisPlanner: AgentLike;
  queryCompiler: AgentLike;
  fieldAliases?: Record<string, string>;
  history?: AgentInputItem[];
  triageContext?: { brief?: any; briefNatural?: string } | null;
  onEvent?: (ev: { type: string; detail?: any }) => void;
}): Promise<{ payloadObj?: PlanningPayload; analysisPlan?: AnalysisPlan; error?: string }>
{
  const {
    message,
    datasourceLuid,
    allowedFields,
    analysisPlanner,
    queryCompiler,
    fieldAliases,
    history = [],
    triageContext,
    onEvent,
  } = params;
  safeEmit(onEvent as any, { type: "plan:start" });
  const started = Date.now();

  // --- Step 1: build analysis plan ---
  const analysisMsgs = [
    ...history,
    userMsg(message),
    systemMsg(`datasourceLuid=${datasourceLuid}`),
    systemMsg(`ALLOWED_FIELDS_JSON=${JSON.stringify(allowedFields || [])}`),
  ] as any[];
  if (triageContext?.brief) {
    analysisMsgs.push(systemMsg(`TRIAGE_BRIEF_JSON=${JSON.stringify(triageContext.brief)}`));
  }
  if (triageContext?.briefNatural) {
    analysisMsgs.push(systemMsg(`TRIAGE_BRIEF_TEXT=${triageContext.briefNatural}`));
  }
  analysisMsgs.push(systemMsg("Output a JSON object with keys analysis_plan and step_query_spec."));

  let analysisPlan: AnalysisPlan | undefined;
  let stepQuerySpec: AnalysisPlannerOutputType["step_query_spec"] | undefined;
  const analysisStarted = Date.now();
  try {
    const analysisRes = await run(analysisPlanner, analysisMsgs);
    const analysisTxt = (typeof (analysisRes as any)?.finalOutput === 'string' && (analysisRes as any).finalOutput)
      ? (analysisRes as any).finalOutput
      : extractAllTextOutput((analysisRes as any).output);
    let raw: any = undefined;
    try { raw = JSON.parse(analysisTxt); } catch {}
    const parsed = AnalysisPlannerOutput.safeParse(raw);
    if (!parsed.success) {
      const error = `analysis_plan_validation_failed: ${parsed.error?.issues?.[0]?.message || 'invalid analysis plan output'}`;
      safeEmit(onEvent as any, { type: "plan:error", detail: { message: error, durationMs: Date.now() - started } });
      return { error };
    }
    analysisPlan = parsed.data.analysis_plan;
    stepQuerySpec = parsed.data.step_query_spec;
  } catch (e: any) {
    const error = e?.message || String(e);
    safeEmit(onEvent as any, { type: "plan:error", detail: { message: error, durationMs: Date.now() - started } });
    return { error };
  }
  const analysisDuration = Date.now() - analysisStarted;

  if (!stepQuerySpec) {
    const error = 'analysis_plan_missing_query_spec';
    safeEmit(onEvent as any, { type: "plan:error", detail: { message: error, durationMs: Date.now() - started } });
    return { error };
  }

  // --- Step 2: compile executable query ---
  const compileMsgs = [
    ...history,
    userMsg(message),
    systemMsg(`datasourceLuid=${datasourceLuid}`),
    systemMsg(`ALLOWED_FIELDS_JSON=${JSON.stringify(allowedFields || [])}`),
    ...(fieldAliases && Object.keys(fieldAliases).length > 0 ? [systemMsg(`FIELD_ALIASES_JSON=${JSON.stringify(fieldAliases)}`)] : []),
    systemMsg(`STEP_QUERY_SPEC_JSON=${JSON.stringify(stepQuerySpec)}`),
    systemMsg(`ANALYSIS_PLAN_JSON=${JSON.stringify(analysisPlan)}`),
    systemMsg("Output strict JSON for the query plan only."),
  ] as any[];

  let txt = '';
  const compileStarted = Date.now();
  try {
    const res = await run(queryCompiler, compileMsgs);
    txt = (typeof (res as any)?.finalOutput === 'string' && (res as any).finalOutput)
      ? (res as any).finalOutput
      : extractAllTextOutput((res as any).output);
  } catch (e: any) {
    const error = e?.message || String(e);
    safeEmit(onEvent as any, { type: "plan:error", detail: { message: error, durationMs: Date.now() - started } });
    return { error };
  }
  const compileDuration = Date.now() - compileStarted;

  let raw: any = undefined;
  try { raw = JSON.parse(txt); } catch {}
  const base = raw && typeof raw === 'object' ? raw : {};
  if (!base.datasource) base.datasource = {};
  base.datasource.datasourceLuid = datasourceLuid;
  if (!base.options) base.options = {};
  if (analysisPlan && !base.analysis_plan) base.analysis_plan = analysisPlan;

  const parsed = PlannerPayload.safeParse(base);
  if (!parsed.success) {
    const error = `validation_failed: ${parsed.error?.issues?.[0]?.message || 'invalid payload'}`;
    safeEmit(onEvent as any, { type: "plan:error", detail: { message: error, durationMs: Date.now() - started } });
    return { error };
  }
  const payloadObj = parsed.data;
  const analysisPlanFinal = payloadObj.analysis_plan || analysisPlan;
  const summary = {
    fields: Array.isArray(payloadObj?.query?.fields) ? payloadObj.query.fields.length : 0,
    filters: Array.isArray(payloadObj?.query?.filters) ? payloadObj.query.filters.length : 0,
    options: payloadObj?.options,
  };
  // Build a compact natural-language query summary for UI narration
  let querySummary = '';
  try {
    const q: any = payloadObj?.query || {};
    const fields = Array.isArray(q.fields) ? q.fields : [];
    const first = fields[0] || {};
    const fieldParts: string[] = [];
    if (first?.function && first?.fieldCaption) fieldParts.push(`${first.function}(${first.fieldCaption})`);
    else if (first?.fieldCaption) fieldParts.push(first.fieldCaption);
    // Date/period hint from filters
    let period = '';
    const filters = Array.isArray(q.filters) ? q.filters : [];
    for (const f of filters) {
      const t = String(f?.filterType || '').toUpperCase();
      if (t === 'QUANTITATIVE_DATE') {
        const min = f?.minDate; const max = f?.maxDate;
        if (min && max) { period = ` from ${min} to ${max}`; break; }
      } else if (t === 'DATE') {
        const min = f?.minDate; const max = f?.maxDate;
        if (min && max) { period = ` from ${min} to ${max}`; break; }
      }
    }
    if (fieldParts.length) querySummary = `${fieldParts.join(', ')}${period}`;
  } catch {}
  const detail: any = { summary, query_summary: querySummary };
  if (analysisPlanFinal && Array.isArray(analysisPlanFinal.steps)) {
    detail.analysis_plan = { steps: analysisPlanFinal.steps.length, overview: analysisPlanFinal.overview };
  }
  detail.durationMs = Date.now() - started;
  detail.analysis_duration_ms = analysisDuration;
  detail.compile_duration_ms = compileDuration;
  safeEmit(onEvent as any, { type: "plan:done", detail });
  const payloadWithPlan = analysisPlanFinal && !payloadObj.analysis_plan
    ? { ...payloadObj, analysis_plan: analysisPlanFinal }
    : payloadObj;
  return { payloadObj: payloadWithPlan, analysisPlan: analysisPlanFinal };
}
