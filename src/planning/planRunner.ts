import { run, user as userMsg, system as systemMsg, extractAllTextOutput } from "@openai/agents";
import { PlannerPayload, type PlanningPayload } from "./schemas";
import { safeEmit } from "../utils/events";

type AgentLike = any;

export async function planRunner(params: {
  message: string;
  datasourceLuid: string;
  allowedFields: Array<{ fieldCaption: string; function?: string }>;
  queryCompiler: AgentLike;
  fieldAliases?: Record<string, string>;
  onEvent?: (ev: { type: string; detail?: any }) => void;
}): Promise<{ payloadObj?: PlanningPayload; error?: string }>
{
  const { message, datasourceLuid, allowedFields, queryCompiler, fieldAliases, onEvent } = params;
  safeEmit(onEvent as any, { type: "plan:start" });

  const msgs = [
    userMsg(message),
    systemMsg(`datasourceLuid=${datasourceLuid}`),
    systemMsg(`ALLOWED_FIELDS_JSON=${JSON.stringify(allowedFields || [])}`),
    ...(fieldAliases && Object.keys(fieldAliases).length > 0 ? [systemMsg(`FIELD_ALIASES_JSON=${JSON.stringify(fieldAliases)}`)] : []),
    systemMsg("Output strict JSON for the query plan only."),
  ] as any[];

  let txt = '';
  try {
    const res = await run(queryCompiler, msgs);
    txt = (typeof (res as any)?.finalOutput === 'string' && (res as any).finalOutput)
      ? (res as any).finalOutput
      : extractAllTextOutput((res as any).output);
  } catch (e: any) {
    const error = e?.message || String(e);
    safeEmit(onEvent as any, { type: "plan:error", detail: { message: error } });
    return { error };
  }

  let raw: any = undefined;
  try { raw = JSON.parse(txt); } catch {}
  const base = raw && typeof raw === 'object' ? raw : {};
  if (!base.datasource) base.datasource = {};
  base.datasource.datasourceLuid = datasourceLuid;
  if (!base.options) base.options = {};

  const parsed = PlannerPayload.safeParse(base);
  if (!parsed.success) {
    const error = `validation_failed: ${parsed.error?.issues?.[0]?.message || 'invalid payload'}`;
    safeEmit(onEvent as any, { type: "plan:error", detail: { message: error } });
    return { error };
  }
  const payloadObj = parsed.data;
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
  safeEmit(onEvent as any, { type: "plan:done", detail: { summary, query_summary: querySummary } });
  return { payloadObj };
}
