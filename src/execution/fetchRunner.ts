import { run, user as userMsg, system as systemMsg, extractAllTextOutput } from "@openai/agents";
import { safeEmit } from "../utils/events";
import { preflightValidateQuery } from "../utils/preflight";
import { tableauClient } from "../data/tableauClient";
import { saveVdsJson } from "../utils/artifacts";
import { buildQueryCompilerAgent } from "../agents/queryCompiler";
import { PlannerPayload, type AnalysisPlan } from "../planning/schemas";

type FilterHint = {
  fieldCaption: string;
  operator?: string;
  values?: any[];
  note?: string;
};

type FetchRetrySource = "builder" | "preflight" | "tableau";

interface QueryField {
  fieldCaption: string;
  function?: string;
}

const MAX_ATTEMPTS = 3;

export async function fetchRunner(params: {
  datasourceLuid: string;
  message: string;
  analysisPlan?: AnalysisPlan;
  allowedFields: Array<QueryField>;
  triageContext?: { requiredFields?: string[]; filterHints?: FilterHint[] } | null;
  fieldAliases?: Record<string, string>;
  onEvent?: (ev: { type: string; detail?: any }) => void;
  abortSignal?: AbortSignal;
}): Promise<{ fetchedSummary?: string; artifactPath?: string; error?: string; cancelled?: boolean }>
{
  const { datasourceLuid, message, analysisPlan, allowedFields, triageContext, fieldAliases, onEvent, abortSignal } = params;
  safeEmit(onEvent as any, { type: "fetch:start" });
  const started = Date.now();

  const isAborted = () => Boolean(abortSignal?.aborted);
  if (isAborted()) {
    return { cancelled: true };
  }

  const builder = buildQueryCompilerAgent();
  const requiredFields = triageContext?.requiredFields ?? [];
  const filterHints = triageContext?.filterHints ?? [];

  const baseMsgs = [
    userMsg(message),
    systemMsg(`datasourceLuid=${datasourceLuid}`),
    systemMsg(`ALLOWED_FIELDS_JSON=${JSON.stringify(allowedFields || [])}`),
    systemMsg(`REQUIRED_FIELDS_JSON=${JSON.stringify(requiredFields || [])}`),
    systemMsg(`FILTER_HINTS_JSON=${JSON.stringify(filterHints || [])}`),
  ] as any[];

  if (analysisPlan) {
    baseMsgs.push(systemMsg(`ANALYSIS_PLAN_JSON=${JSON.stringify(analysisPlan)}`));
  }
  if (fieldAliases && Object.keys(fieldAliases).length) {
    baseMsgs.push(systemMsg(`FIELD_ALIASES_JSON=${JSON.stringify(fieldAliases)}`));
  }

  const feedbackHistory: Array<{ attempt: number; source: FetchRetrySource; message: string }> = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (isAborted()) {
      return { cancelled: true };
    }

    const attemptMsgs = [...baseMsgs];
    if (feedbackHistory.length) {
      attemptMsgs.push(systemMsg(`BUILDER_FEEDBACK_JSON=${JSON.stringify(feedbackHistory.slice(-3))}`));
    }
    attemptMsgs.push(systemMsg(`ATTEMPT_INDEX=${attempt}`));

    let builderOutput = "";
    try {
      const res = await run(builder, attemptMsgs);
      builderOutput =
        typeof (res as any)?.finalOutput === "string" && (res as any).finalOutput
          ? (res as any).finalOutput
          : extractAllTextOutput((res as any).output);
    } catch (e: any) {
      if (isAborted()) {
        return { cancelled: true };
      }
      const messageText = e?.message || String(e);
      feedbackHistory.push({ attempt, source: "builder", message: messageText });
      safeEmit(onEvent as any, { type: "fetch:retry", detail: { attempt, source: "builder", message: messageText } });
      if (attempt >= MAX_ATTEMPTS) {
        safeEmit(onEvent as any, { type: "fetch:error", detail: { message: messageText, durationMs: Date.now() - started } });
        return { error: messageText };
      }
      continue;
    }

    let parsed: any = null;
    try { parsed = JSON.parse(builderOutput); } catch {}
    const validated = PlannerPayload.safeParse(parsed);
    if (!validated.success) {
      const issue = validated.error?.issues?.[0]?.message || "vizql_builder_validation_failed";
      feedbackHistory.push({ attempt, source: "builder", message: issue });
      safeEmit(onEvent as any, { type: "fetch:retry", detail: { attempt, source: "builder", message: issue } });
      if (attempt >= MAX_ATTEMPTS) {
        safeEmit(onEvent as any, { type: "fetch:error", detail: { message: issue, durationMs: Date.now() - started } });
        return { error: issue };
      }
      continue;
    }

    const payload = validated.data;
    const query = payload.query;

    if (isAborted()) {
      return { cancelled: true };
    }

    const preErr = preflightValidateQuery(query);
    if (preErr) {
      feedbackHistory.push({ attempt, source: "preflight", message: preErr });
      safeEmit(onEvent as any, { type: "fetch:retry", detail: { attempt, source: "preflight", message: preErr } });
      if (attempt >= MAX_ATTEMPTS) {
        const messageText = `preflight:${preErr}`;
        safeEmit(onEvent as any, { type: "fetch:error", detail: { message: messageText, durationMs: Date.now() - started } });
        return { error: messageText };
      }
      continue;
    }

    if (isAborted()) {
      return { cancelled: true };
    }

    try {
      const res = await tableauClient.queryDatasource({ datasourceLuid, query, signal: abortSignal });
      if (isAborted()) {
        return { cancelled: true };
      }
      const tableauError = extractTableauError(res);
      if (tableauError) {
        feedbackHistory.push({ attempt, source: "tableau", message: tableauError });
        safeEmit(onEvent as any, { type: "fetch:retry", detail: { attempt, source: "tableau", message: tableauError } });
        if (attempt >= MAX_ATTEMPTS) {
          safeEmit(onEvent as any, { type: "fetch:error", detail: { message: tableauError, durationMs: Date.now() - started } });
          return { error: tableauError };
        }
        continue;
      }
      const summary = summarizeResult(res);
      let artifactPath = "";
      try {
        const normalized = normalizeResult(res);
        const art = saveVdsJson(normalized);
        artifactPath = art.relPath;
      } catch {}
      safeEmit(onEvent as any, { type: "fetch:done", detail: { summary, artifact: artifactPath || undefined, durationMs: Date.now() - started } });
      return { fetchedSummary: summary, artifactPath };
    } catch (e: any) {
      if (isAborted() || e?.name === "AbortError" || e?.message === "aborted") {
        return { cancelled: true };
      }
      const raw = e?.message || String(e);
      const parsedError = tryParseJson(raw);
      const messageText = parsedError?.message || raw;
      feedbackHistory.push({ attempt, source: "tableau", message: messageText });
      safeEmit(onEvent as any, { type: "fetch:retry", detail: { attempt, source: "tableau", message: messageText } });
      if (attempt >= MAX_ATTEMPTS) {
        safeEmit(onEvent as any, { type: "fetch:error", detail: { message: messageText, durationMs: Date.now() - started } });
        return { error: messageText };
      }
    }
  }

  const fallback = feedbackHistory.length ? feedbackHistory[feedbackHistory.length - 1].message : "fetch_failed";
  safeEmit(onEvent as any, { type: "fetch:error", detail: { message: fallback, durationMs: Date.now() - started } });
  return { error: fallback };
}

function summarizeResult(res: any): string {
  try {
    if (typeof res === "string") return res;
    if (Array.isArray(res)) return `rows=${res.length}`;
    if (res && typeof res === "object") {
      for (const key of ["rows", "data", "results"]) {
        const maybe = (res as any)[key];
        if (Array.isArray(maybe)) return `${key}=${maybe.length}`;
      }
      const serialized = JSON.stringify(res);
      return serialized.length > 800 ? serialized.slice(0, 800) : serialized;
    }
    return String(res);
  } catch {
    return "[unserializable fetch result]";
  }
}

function extractTableauError(res: any): string | null {
  try {
    if (res == null) return null;
    const candidates: string[] = [];
    const inspect = (value: any, requireErrorKeyword = false) => {
      if (value == null) return;
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return;
        const hasErrorToken = /error|exception|invalid|denied|failed/i.test(trimmed);
        if (!requireErrorKeyword || hasErrorToken) {
          candidates.push(trimmed);
        }
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) inspect(item, requireErrorKeyword);
        return;
      }
      if (typeof value === "object") {
        if (typeof value.error === "string" && value.error.trim()) {
          candidates.push(value.error.trim());
        }
        if (typeof value.message === "string") {
          const message = value.message.trim();
          if (message && /error|exception|invalid|denied|failed/i.test(message)) {
            candidates.push(message);
          }
        }
        if (typeof value.text === "string") {
          const text = value.text.trim();
          if (text && /error|exception|invalid|denied|failed/i.test(text)) {
            candidates.push(text);
          }
        }
        if (Array.isArray((value as any).errors)) {
          inspect((value as any).errors, requireErrorKeyword);
        }
        if (typeof (value as any).status === "string" && (value as any).status.toLowerCase() === "error") {
          if (typeof (value as any).detail === "string" && (value as any).detail.trim()) {
            candidates.push((value as any).detail.trim());
          } else if (typeof (value as any).message === "string" && (value as any).message.trim()) {
            candidates.push((value as any).message.trim());
          }
        }
      }
    };
    if (typeof res === "string") {
      try {
        const parsed = JSON.parse(res);
        const nested = extractTableauError(parsed);
        if (nested) return nested;
      } catch {}
      inspect(res);
    } else {
      inspect(res);
    }
    return candidates.length ? candidates[0] : null;
  } catch {
    return null;
  }
}

function normalizeResult(res: any): any {
  try {
    if (Array.isArray(res) && res.length > 0 && res[0] && typeof res[0] === "object" && typeof (res[0] as any).text === "string") {
      const text = (res[0] as any).text as string;
      return JSON.parse(text);
    }
    if (typeof res === "string") {
      return JSON.parse(res);
    }
  } catch {}
  return res;
}

function tryParseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

