import { run, user as userMsg, system as systemMsg, extractAllTextOutput, type AgentInputItem } from "@openai/agents";
import { safeEmit } from "../utils/events";
import type { FilterHint } from "../types/orchestrator";
import type { NormalizedField } from "../utils/metadataCache";

export async function runFieldSelector(params: {
  enabled: boolean;
  message: string;
  normalizedFields: Array<{ fieldCaption: string; dataType?: string; defaultAggregation?: string | null }>;
  requiredFields?: string[];
  filterHints?: FilterHint[];
  maxList: number;
  agent: any;
  history?: AgentInputItem[];
  onEvent?: (ev: { type: string; detail?: any }) => void;
}): Promise<{
  allowedFields?: Array<{ fieldCaption: string; function?: string }>;
  suggestedAliases?: Record<string, string>;
  clarify?: { message: string; candidates?: Array<string> };
}>
{
  const { enabled, message, normalizedFields, requiredFields = [], filterHints = [], maxList, agent, history = [], onEvent } = params;
  if (!enabled) return {};

  safeEmit(onEvent as any, { type: "selector:start", detail: { max: maxList, count: normalizedFields.length } });
  const started = Date.now();
  const payloadFields = normalizedFields.map((f) => ({ fieldCaption: f.fieldCaption, dataType: f.dataType, defaultAggregation: f.defaultAggregation }));
  const msgs = [
    ...history,
    userMsg(message),
    systemMsg(`MAX_N=${maxList}`),
    systemMsg(`AVAILABLE_FIELDS_JSON=${JSON.stringify(payloadFields)}`),
  ] as any[];
  if (requiredFields.length) {
    msgs.push(systemMsg(`MUST_INCLUDE_FIELDS_JSON=${JSON.stringify(requiredFields)}`));
  }
  if (filterHints.length) {
    msgs.push(systemMsg(`FILTER_HINTS_JSON=${JSON.stringify(filterHints)}`));
  }

  const normalizedMap = new Map<string, NormalizedField>();
  for (const field of normalizedFields) {
    normalizedMap.set(field.fieldCaption, field);
  }

  let txt = "";
  try {
    const res = await run(agent, msgs);
    txt = (typeof (res as any)?.finalOutput === "string" && (res as any).finalOutput)
      ? (res as any).finalOutput
      : extractAllTextOutput((res as any).output);
  } catch (e: any) {
    safeEmit(onEvent as any, { type: "selector:error", detail: { message: e?.message || String(e), durationMs: Date.now() - started } });
    return {};
  }

  let obj: any = null;
  try { obj = JSON.parse(txt); } catch {}

  const clarifyFromAgent = (() => {
    if (!obj || typeof obj !== "object") return undefined;
    const clarify = obj.clarify;
    if (!clarify || typeof clarify !== "object") return undefined;
    const message = typeof clarify.question === "string" ? clarify.question.trim() : typeof clarify.message === "string" ? clarify.message.trim() : "";
    if (!message) return undefined;
    const candidatesRaw = Array.isArray(clarify.candidates) ? clarify.candidates : undefined;
    const candidates = candidatesRaw?.map((c: any) => (typeof c === "string" ? c : typeof c?.fieldCaption === "string" ? c.fieldCaption : null)).filter((v: string | null): v is string => !!v);
    return { message, candidates: candidates && candidates.length ? candidates : undefined };
  })();

  const list = Array.isArray(obj?.allowedFields) ? obj.allowedFields : [];
  const allowedMap = new Map<string, { fieldCaption: string; function?: string }>();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const caption = typeof entry.fieldCaption === "string" ? entry.fieldCaption.trim() : "";
    if (!caption || !normalizedMap.has(caption)) continue;
    const func = typeof entry.function === "string" ? entry.function.trim().toUpperCase() : undefined;
    allowedMap.set(caption, func ? { fieldCaption: caption, function: func } : { fieldCaption: caption });
  }

  const requiredClean = requiredFields
    .map((f) => (typeof f === "string" ? f.trim() : ""))
    .filter((f) => !!f);

  const missingRequired: string[] = [];
  for (const required of requiredClean) {
    if (!normalizedMap.has(required)) {
      missingRequired.push(required);
      continue;
    }
    if (!allowedMap.has(required)) {
      const meta = normalizedMap.get(required);
      const fn = meta?.defaultAggregation ? String(meta.defaultAggregation).toUpperCase() : undefined;
      allowedMap.set(required, fn ? { fieldCaption: required, function: fn } : { fieldCaption: required });
    }
  }

  if (missingRequired.length) {
    const messageText = `The datasource does not include required field(s): ${missingRequired.join(", ")}. Please provide the exact field name(s) to use.`;
    const candidates = normalizedFields.slice(0, 12).map((f) => f.fieldCaption);
    return {
      clarify: {
        message: messageText,
        candidates,
      },
    };
  }

  let allowed = Array.from(allowedMap.values());

  const requiredSet = new Set(requiredClean);
  if (requiredSet.size) {
    const requiredItems = allowed.filter((f) => requiredSet.has(f.fieldCaption));
    const otherItems = allowed.filter((f) => !requiredSet.has(f.fieldCaption));
    const limit = Math.max(1, maxList);
    const extraSlots = Math.max(0, limit - requiredItems.length);
    const trimmedOthers = otherItems.slice(0, extraSlots);
    allowed = requiredItems.length > limit ? requiredItems : requiredItems.concat(trimmedOthers);
  } else {
    allowed = allowed.slice(0, Math.max(1, maxList));
  }

  if (allowed.length === 0) {
    if (clarifyFromAgent) {
      return { clarify: clarifyFromAgent };
    }
    safeEmit(onEvent as any, { type: "selector:error", detail: { reason: "no_valid_selection", durationMs: Date.now() - started } });
    return {};
  }

  const preview = allowed.map((a) => a.fieldCaption).slice(0, 8);
  safeEmit(onEvent as any, { type: "selector:done", detail: { selected: allowed.length, fields: preview, durationMs: Date.now() - started } });

  const suggestedAliases: Record<string, string> = {};
  if (obj?.suggestedAliases && typeof obj.suggestedAliases === "object") {
    for (const [k, v] of Object.entries(obj.suggestedAliases)) {
      if (typeof v === "string" && normalizedMap.has(v)) suggestedAliases[k] = v;
    }
  }

  if (clarifyFromAgent && preview.length === 0) {
    return { clarify: clarifyFromAgent };
  }

  return { allowedFields: allowed, suggestedAliases, clarify: clarifyFromAgent };
}

