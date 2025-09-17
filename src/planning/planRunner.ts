import { run, user as userMsg, system as systemMsg, extractAllTextOutput, type AgentInputItem } from "@openai/agents";
import {
  PlannerPayload,
  AnalysisPlannerOutput,
  type PlanningPayload,
  type AnalysisPlan,
  type AnalysisPlannerOutputType,
} from "./schemas";
import { safeEmit } from "../utils/events";

function extractTokenUsage(raw: any): { total?: number; input?: number; output?: number } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const total =
    typeof (raw as any).total_tokens === "number"
      ? (raw as any).total_tokens
      : typeof (raw as any).totalTokens === "number"
      ? (raw as any).totalTokens
      : undefined;
  const input =
    typeof (raw as any).prompt_tokens === "number"
      ? (raw as any).prompt_tokens
      : typeof (raw as any).inputTokens === "number"
      ? (raw as any).inputTokens
      : typeof (raw as any).promptTokens === "number"
      ? (raw as any).promptTokens
      : undefined;
  const output =
    typeof (raw as any).completion_tokens === "number"
      ? (raw as any).completion_tokens
      : typeof (raw as any).outputTokens === "number"
      ? (raw as any).outputTokens
      : typeof (raw as any).completionTokens === "number"
      ? (raw as any).completionTokens
      : undefined;

  const collected: Record<string, number> = {};
  if (typeof total === "number") collected.total = total;
  if (typeof input === "number") collected.input = input;
  if (typeof output === "number") collected.output = output;
  return Object.keys(collected).length > 0 ? collected : undefined;
}

function toSnippet(value: string | undefined | null, limit = 400): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.replace(/\s+/g, ' ');
  return normalized.length > limit ? normalized.slice(0, limit) + '...' : normalized;
}

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
  safeEmit(onEvent as any, {
    type: "plan:analysis:start",
    detail: {
      allowedFields: Array.isArray(allowedFields) ? allowedFields.length : 0,
    },
  });

  let analysisUsage: Record<string, number> | undefined;
  let analysisTxt = '';
  let analysisPlan: AnalysisPlan | undefined;
  let stepQuerySpec: AnalysisPlannerOutputType["step_query_spec"] | undefined;

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

  const analysisStarted = Date.now();
  try {
    const analysisRes = await run(analysisPlanner, analysisMsgs);
    analysisUsage = extractTokenUsage((analysisRes as any)?.usage);
    analysisTxt =
      typeof (analysisRes as any)?.finalOutput === "string" && (analysisRes as any).finalOutput
        ? (analysisRes as any).finalOutput
        : extractAllTextOutput((analysisRes as any).output);
    let raw: any = undefined;
    try {
      raw = JSON.parse(analysisTxt);
    } catch {}
    const parsed = AnalysisPlannerOutput.safeParse(raw);
    if (!parsed.success) {
      const error = `analysis_plan_validation_failed: ${parsed.error?.issues?.[0]?.message || 'invalid analysis plan output'}`;
      const snippet = toSnippet(analysisTxt);
      const detail: Record<string, unknown> = { message: error, durationMs: Date.now() - analysisStarted, issues: parsed.error.issues };
      if (snippet) detail.outputSnippet = snippet;
      safeEmit(onEvent as any, { type: "plan:analysis:error", detail });
      safeEmit(onEvent as any, { type: "plan:error", detail });
      return { error };
    }
    analysisPlan = parsed.data.analysis_plan;
    stepQuerySpec = parsed.data.step_query_spec;
  } catch (e: any) {
    const error = e?.message || String(e);
    const detail = { message: error, durationMs: Date.now() - analysisStarted };
    safeEmit(onEvent as any, { type: "plan:analysis:error", detail });
    safeEmit(onEvent as any, { type: "plan:error", detail });
    return { error };
  }
  const analysisDuration = Date.now() - analysisStarted;

  if (!stepQuerySpec) {
    const error = 'analysis_plan_missing_query_spec';
    const detail = { message: error, durationMs: analysisDuration };
    safeEmit(onEvent as any, { type: "plan:analysis:error", detail });
    safeEmit(onEvent as any, { type: "plan:error", detail });
    return { error };
  }

  const analysisDetail: Record<string, unknown> = { durationMs: analysisDuration };
  if (analysisUsage) analysisDetail.usage = analysisUsage;
  if (analysisPlan) {
    if (Array.isArray(analysisPlan.steps)) analysisDetail.steps = analysisPlan.steps.length;
    if (typeof analysisPlan.overview === "string" && analysisPlan.overview.trim()) {
      analysisDetail.overview = analysisPlan.overview;
    }
  }
  analysisDetail.step_query_spec = {
    fields: Array.isArray(stepQuerySpec.fields) ? stepQuerySpec.fields.length : 0,
    filters: Array.isArray(stepQuerySpec.filters) ? stepQuerySpec.filters.length : 0,
  };
  safeEmit(onEvent as any, { type: "plan:analysis:done", detail: analysisDetail });

  // --- Step 2: compile executable query ---
  safeEmit(onEvent as any, {
    type: "plan:compile:start",
    detail: {
      fields: Array.isArray(stepQuerySpec.fields) ? stepQuerySpec.fields.length : 0,
      filters: Array.isArray(stepQuerySpec.filters) ? stepQuerySpec.filters.length : 0,
    },
  });

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

  let compileUsage: Record<string, number> | undefined;
  let compileTxt = '';
  const compileStarted = Date.now();
  try {
    const res = await run(queryCompiler, compileMsgs);
    compileUsage = extractTokenUsage((res as any)?.usage);
    compileTxt =
      typeof (res as any)?.finalOutput === "string" && (res as any).finalOutput
        ? (res as any).finalOutput
        : extractAllTextOutput((res as any).output);
  } catch (e: any) {
    const error = e?.message || String(e);
    const detail = { message: error, durationMs: Date.now() - compileStarted };
    safeEmit(onEvent as any, { type: "plan:compile:error", detail });
    safeEmit(onEvent as any, { type: "plan:error", detail });
    return { error };
  }
  const compileDuration = Date.now() - compileStarted;

  let raw: any = undefined;
  try {
    raw = JSON.parse(compileTxt);
  } catch {}
  const base = raw && typeof raw === "object" ? raw : {};
  if (!base.datasource) base.datasource = {};
  base.datasource.datasourceLuid = datasourceLuid;
  if (!base.options) base.options = {};
  if (analysisPlan && !base.analysis_plan) base.analysis_plan = analysisPlan;

  const parsed = PlannerPayload.safeParse(base);
  if (!parsed.success) {
    const error = `validation_failed: ${parsed.error?.issues?.[0]?.message || 'invalid payload'}`;
    const snippet = toSnippet(compileTxt);
    const detail: Record<string, unknown> = { message: error, durationMs: compileDuration, issues: parsed.error.issues };
    if (snippet) detail.outputSnippet = snippet;
    safeEmit(onEvent as any, { type: "plan:compile:error", detail });
    safeEmit(onEvent as any, { type: "plan:error", detail });
    return { error };
  }

  const payloadObj = parsed.data;
  const analysisPlanFinal = payloadObj.analysis_plan || analysisPlan;

  const compileDetail: Record<string, unknown> = { durationMs: compileDuration };
  if (compileUsage) compileDetail.usage = compileUsage;
  compileDetail.query = {
    fields: Array.isArray(payloadObj?.query?.fields) ? payloadObj.query.fields.length : 0,
    filters: Array.isArray(payloadObj?.query?.filters) ? payloadObj.query.filters.length : 0,
  };
  safeEmit(onEvent as any, { type: "plan:compile:done", detail: compileDetail });

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
      if (t === "QUANTITATIVE_DATE") {
        const min = (f as any)?.minDate;
        const max = (f as any)?.maxDate;
        if (min && max) {
          period = ` from ${min} to ${max}`;
          break;
        }
      } else if (t === "DATE") {
        const min = (f as any)?.minDate;
        const max = (f as any)?.maxDate;
        if (min && max) {
          period = ` from ${min} to ${max}`;
          break;
        }
      }
    }
    if (fieldParts.length) querySummary = `${fieldParts.join(', ')}${period}`;
  } catch {}

  const detail: any = { summary, query_summary: querySummary };
  if (analysisUsage) detail.analysis_usage = analysisUsage;
  if (compileUsage) detail.compile_usage = compileUsage;
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
