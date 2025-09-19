import { run, user as userMsg, system as systemMsg, extractAllTextOutput } from "@openai/agents";
import { safeEmit } from "../utils/events";
import { preflightValidateQuery } from "../utils/preflight";
import { tableauClient } from "../data/tableauClient";
import { saveVdsJson } from "../utils/artifacts";
import { buildPlannerAgent } from "../agents/planner";
import { PlannerPayload, AnalysisPlan } from "../planning/schemas";

export type FetchFeedback = {
  attempt: number;
  source: "builder" | "preflight" | "tableau";
  message: string;
  raw?: any;
};

const MAX_ATTEMPTS = 3;

export async function fetchRunner(params: {
  datasourceLuid: string;
  message: string;
  analysisPlan: AnalysisPlan;
  allowedFields: Array<{ fieldCaption: string; function?: string }>;
  triageContext?: { requiredFields?: string[]; filterHints?: any[] } | null;
  fieldAliases?: Record<string, string>;
  onEvent?: (ev: { type: string; detail?: any }) => void;
}): Promise<{ fetchedSummary?: string; artifactPath?: string; error?: string; feedback?: FetchFeedback[] }>
{
  const { datasourceLuid, message, analysisPlan, allowedFields, triageContext, fieldAliases, onEvent } = params;
  safeEmit(onEvent as any, { type: "fetch:start" });
  const started = Date.now();

  const builder = buildPlannerAgent();
  const feedbackHistory: FetchFeedback[] = [];

  const baseMsgs = [
    userMsg(message),
    systemMsg(`datasourceLuid=${datasourceLuid}`),
    systemMsg(`ALLOWED_FIELDS_JSON=${JSON.stringify(allowedFields || [])}`),
    systemMsg(`ANALYSIS_PLAN_JSON=${JSON.stringify(analysisPlan || {})}`),
  ] as any[];

  if (triageContext?.requiredFields?.length) {
    baseMsgs.push(systemMsg(`TRIAGE_REQUIRED_FIELDS_JSON=${JSON.stringify(triageContext.requiredFields)}`));
  }
  if (triageContext?.filterHints?.length) {
    baseMsgs.push(systemMsg(`TRIAGE_FILTER_HINTS_JSON=${JSON.stringify(triageContext.filterHints)}`));
  }
  if (fieldAliases && Object.keys(fieldAliases).length > 0) {
    baseMsgs.push(systemMsg(`FIELD_ALIASES_JSON=${JSON.stringify(fieldAliases)}`));
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptMsgs = [...baseMsgs];
    if (feedbackHistory.length) {
      const recent = feedbackHistory.slice(-3);
      attemptMsgs.push(systemMsg(`BUILDER_FEEDBACK_JSON=${JSON.stringify(recent)}`));
    }
    attemptMsgs.push(systemMsg(`ATTEMPT_INDEX=${attempt}`));

    let builderOutputText = "";
    try {
      const res = await run(builder, attemptMsgs);
      builderOutputText =
        typeof (res as any)?.finalOutput === "string" && (res as any).finalOutput
          ? (res as any).finalOutput
          : extractAllTextOutput((res as any).output);
    } catch (e: any) {
      const messageText = e?.message || String(e);
      feedbackHistory.push({ attempt, source: "builder", message: messageText });
      if (attempt >= MAX_ATTEMPTS) {
        safeEmit(onEvent as any, { type: "fetch:error", detail: { message: messageText, durationMs: Date.now() - started } });
        return { error: messageText, feedback: feedbackHistory };
      }
      continue;
    }

    let parsed: any = null;
    try { parsed = JSON.parse(builderOutputText); } catch {}
    const validated = PlannerPayload.safeParse(parsed);
    if (!validated.success) {
      const issue = validated.error?.issues?.[0]?.message || "vizql_builder_validation_failed";
      feedbackHistory.push({ attempt, source: "builder", message: issue, raw: validated.error.issues });
      if (attempt >= MAX_ATTEMPTS) {
        safeEmit(onEvent as any, { type: "fetch:error", detail: { message: issue, durationMs: Date.now() - started } });
        return { error: issue, feedback: feedbackHistory };
      }
      continue;
    }

    const payload = validated.data;
    const query = payload.query;

    const preErr = preflightValidateQuery(query);
    if (preErr) {
      feedbackHistory.push({ attempt, source: "preflight", message: preErr });
      if (attempt >= MAX_ATTEMPTS) {
        const messageText = `preflight:${preErr}`;
        safeEmit(onEvent as any, { type: "fetch:error", detail: { message: messageText, durationMs: Date.now() - started } });
        return { error: messageText, feedback: feedbackHistory };
      }
      continue;
    }

    try {
      const res = await tableauClient.queryDatasource({ datasourceLuid, query });
      const toText = (v: any): string => {
        try {
          if (typeof v === "string") return v;
          if (Array.isArray(v)) return `rows=${v.length}`;
          if (v && typeof v === "object") {
            const keys = ["rows", "data", "results"];
            for (const k of keys) {
              const arr = (v as any)[k];
              if (Array.isArray(arr)) return `${k}=${arr.length}`;
            }
            const s = JSON.stringify(v);
            return s.length > 800 ? s.slice(0, 800) : s;
          }
          return String(v);
        } catch { return "[unserializable fetch result]"; }
      };

      const summary = toText(res);
      let artifactPath = "";
      try {
        const normalized = (() => {
          try {
            if (Array.isArray(res) && res.length > 0 && res[0] && typeof res[0] === "object" && typeof (res[0] as any).text === "string") {
              const t = (res[0] as any).text as string;
              try { return JSON.parse(t); } catch { return res; }
            }
            if (typeof res === "string") { try { return JSON.parse(res); } catch { return res; } }
          } catch {}
          return res;
        })();
        const art = saveVdsJson(normalized);
        artifactPath = art.relPath;
      } catch {}

      safeEmit(onEvent as any, {
        type: "fetch:done",
        detail: { summary, artifact: artifactPath || undefined, durationMs: Date.now() - started },
      });
      return { fetchedSummary: summary, artifactPath, feedback: feedbackHistory };
    } catch (e: any) {
      const rawMessage = e?.message || String(e);
      let parsedError: any = null;
      try { parsedError = JSON.parse(rawMessage); } catch {}
      const feedback: FetchFeedback = {
        attempt,
        source: "tableau",
        message: parsedError?.message || rawMessage,
        raw: parsedError || rawMessage,
      };
      feedbackHistory.push(feedback);
      if (attempt >= MAX_ATTEMPTS) {
        safeEmit(onEvent as any, { type: "fetch:error", detail: { message: feedback.message, durationMs: Date.now() - started } });
        return { error: feedback.message, feedback: feedbackHistory };
      }
    }
  }

  const fallback = feedbackHistory.length ? feedbackHistory[feedbackHistory.length - 1].message : "fetch_failed";
  safeEmit(onEvent as any, { type: "fetch:error", detail: { message: fallback, durationMs: Date.now() - started } });
  return { error: fallback, feedback: feedbackHistory };
}
