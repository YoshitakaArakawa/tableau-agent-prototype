import { run, user as userMsg, extractAllTextOutput, system as systemMsg, type AgentInputItem } from "@openai/agents";
import type { OrchestratorEvent, TriageDecision, TriageContext, FilterHint } from "../types/orchestrator";
import type { NormalizedField } from "../utils/metadataCache";
import { safeEmit } from "../utils/events";
import { AnalysisPlanSpec, type AnalysisPlan } from "../planning/schemas";

function sanitizeRequiredFields(raw: unknown, normalized: NormalizedField[]): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const available = new Set(normalized.map((f) => f.fieldCaption));
  const cleaned: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const caption = entry.trim();
    if (!caption) continue;
    if (available.has(caption)) cleaned.push(caption);
  }
  return cleaned.length ? Array.from(new Set(cleaned)) : undefined;
}

function sanitizeFilterHints(raw: unknown, normalized: NormalizedField[]): FilterHint[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const available = new Set(normalized.map((f) => f.fieldCaption));
  const hints: FilterHint[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const fieldCaption = typeof (entry as any).fieldCaption === "string" ? (entry as any).fieldCaption.trim() : "";
    if (!fieldCaption || !available.has(fieldCaption)) continue;
    const operator = typeof (entry as any).operator === "string" ? (entry as any).operator.trim().toUpperCase() : undefined;
    const valuesRaw = Array.isArray((entry as any).values) ? (entry as any).values : undefined;
    const values = valuesRaw ? valuesRaw.filter((v: any) => typeof v === "string" && v.trim()).map((v: string) => v.trim()) : undefined;
    const note = typeof (entry as any).note === "string" ? (entry as any).note.trim() : undefined;
    const hint: FilterHint = { fieldCaption };
    if (operator && ["IN", "EQ", "MATCH", "CONTAINS"].includes(operator)) hint.operator = operator as FilterHint["operator"];
    if (values && values.length) hint.values = Array.from(new Set(values));
    if (note) hint.note = note;
    hints.push(hint);
  }
  return hints.length ? hints : undefined;
}

export async function triagePhase(params: {
  message: string;
  triageAgent: any;
  normalizedFields: NormalizedField[];
  history?: AgentInputItem[];
  onEvent?: (ev: OrchestratorEvent) => void;
}): Promise<{ decision?: TriageDecision; clarifyReply?: string; triageRaw?: string; triageObj?: any; context?: TriageContext }>
{
  const { message, triageAgent, normalizedFields, history = [], onEvent } = params;
  safeEmit(onEvent, { type: "triage:start", detail: { message } });
  const started = Date.now();

  const fieldPayload = normalizedFields.slice(0, 120).map((f) => ({
    fieldCaption: f.fieldCaption,
    dataType: f.dataType,
    defaultAggregation: f.defaultAggregation ?? undefined,
  }));

  let res: any;
  try {
    const msgs: AgentInputItem[] = [
      ...history,
      userMsg(message),
      systemMsg(`AVAILABLE_FIELDS_JSON=${JSON.stringify(fieldPayload)}`),
    ];
    res = await run(triageAgent, msgs as any);
  } catch (e: any) {
    const msg = e?.message || String(e);
    safeEmit(onEvent, { type: "triage:error", detail: { message: msg } });
    throw e;
  }

  const triageJsonTxt = (typeof (res as any)?.finalOutput === "string" && (res as any).finalOutput)
    ? (res as any).finalOutput
    : extractAllTextOutput((res as any).output);

  let triageObj: any = undefined;
  try { triageObj = JSON.parse(triageJsonTxt); } catch {}

  const decision: TriageDecision = {
    needsData: true,
    needsMetadata: true,
  };
  try {
    if (triageObj && typeof triageObj === "object") {
      if (typeof triageObj.needsData === "boolean") decision.needsData = triageObj.needsData;
      if (typeof triageObj.needsMetadata === "boolean") decision.needsMetadata = triageObj.needsMetadata;
    }
  } catch {}

  const requiredFields = sanitizeRequiredFields(triageObj?.requiredFields, normalizedFields);
  const filterHints = sanitizeFilterHints(triageObj?.filterHints, normalizedFields);
  let analysisPlan: AnalysisPlan | undefined;
  try {
    const parsedPlan = AnalysisPlanSpec.safeParse(triageObj?.analysis_plan);
    if (parsedPlan.success) analysisPlan = parsedPlan.data;
  } catch {}

  const context: TriageContext = {
    brief: triageObj?.brief,
    briefNatural: typeof triageObj?.briefNatural === "string" ? triageObj.briefNatural : undefined,
    requiredFields,
    filterHints,
    analysisPlan,
  };

  safeEmit(onEvent, {
    type: "triage:done",
    detail: { raw: triageJsonTxt, decision, durationMs: Date.now() - started, requiredFields, filterHintsCount: filterHints?.length ?? 0 },
  });

  if (triageObj && triageObj.needsClarification === true && typeof triageObj.message === "string" && triageObj.message.trim()) {
    const reply = String(triageObj.message).trim();
    safeEmit(onEvent, { type: "clarify:request", detail: { text: reply, durationMs: Date.now() - started } });
    return { decision, clarifyReply: reply, triageRaw: triageJsonTxt, triageObj, context };
  }

  return { decision, triageRaw: triageJsonTxt, triageObj, context };
}
