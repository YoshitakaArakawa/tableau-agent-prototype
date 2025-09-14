import { run, user as userMsg, system as systemMsg, extractAllTextOutput } from "@openai/agents";
import { safeEmit } from "../utils/events";

export async function runFieldSelector(params: {
  enabled: boolean;
  message: string;
  normalizedFields: Array<{ fieldCaption: string; dataType?: string; defaultAggregation?: string | null }>;
  maxList: number;
  agent: any;
  onEvent?: (ev: { type: string; detail?: any }) => void;
}): Promise<{ allowedFields?: Array<{ fieldCaption: string; function?: string }>; suggestedAliases?: Record<string, string> }>
{
  const { enabled, message, normalizedFields, maxList, agent, onEvent } = params;
  if (!enabled) return {};

  safeEmit(onEvent as any, { type: 'selector:start', detail: { max: maxList, count: normalizedFields.length } });
  const payloadFields = normalizedFields.map(f => ({ fieldCaption: f.fieldCaption, dataType: f.dataType, defaultAggregation: f.defaultAggregation }));
  const msgs = [
    userMsg(message),
    systemMsg(`MAX_N=${maxList}`),
    systemMsg(`AVAILABLE_FIELDS_JSON=${JSON.stringify(payloadFields)}`),
  ] as any[];

  let txt = '';
  try {
    const res = await run(agent, msgs);
    txt = (typeof (res as any)?.finalOutput === 'string' && (res as any).finalOutput)
      ? (res as any).finalOutput
      : extractAllTextOutput((res as any).output);
  } catch (e: any) {
    safeEmit(onEvent as any, { type: 'selector:error', detail: { message: e?.message || String(e) } });
    return {};
  }

  let obj: any = null;
  try { obj = JSON.parse(txt); } catch {}
  const list = Array.isArray(obj?.allowedFields) ? obj.allowedFields : [];
  const caps = new Set(normalizedFields.map(f => f.fieldCaption));
  const allowed = list
    .filter((it: any) => it && typeof it.fieldCaption === 'string' && caps.has(it.fieldCaption))
    .slice(0, Math.max(1, maxList))
    .map((it: any) => ({ fieldCaption: it.fieldCaption, function: typeof it.function === 'string' ? it.function : undefined }));
  const suggestedAliases: Record<string, string> = {};
  if (obj?.suggestedAliases && typeof obj.suggestedAliases === 'object') {
    for (const [k, v] of Object.entries(obj.suggestedAliases)) {
      if (typeof v === 'string' && caps.has(v)) suggestedAliases[k] = v;
    }
  }
  if (allowed.length > 0) {
    const preview = allowed.map(a => a.fieldCaption).slice(0, 8);
    safeEmit(onEvent as any, { type: 'selector:done', detail: { selected: allowed.length, fields: preview } });
    return { allowedFields: allowed, suggestedAliases };
  }
  safeEmit(onEvent as any, { type: 'selector:error', detail: { reason: 'no_valid_selection' } });
  return {};
}

