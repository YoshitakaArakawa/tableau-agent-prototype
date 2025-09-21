import { summarizeLightweight, countRowsForHeuristic } from "./lightweight";
import { summarizeWithCI } from "./codeInterpreter";
import type { AnalysisPlan } from "../planning/schemas";
import { safeEmit } from "../utils/events";

function emit(
  cb: ((ev: { type: string; detail?: any }) => void) | undefined,
  type: string,
  detail?: any
) {
  safeEmit(cb as any, { type, detail });
}

type SummarizeParams = {
  message: string;
  artifactPaths: string[];
  analysisContext?: any;
  onEvent?: (ev: { type: string; detail?: any }) => void;
  abortSignal?: AbortSignal;
};

type SummarizeResult = { reply?: string; cancelled?: boolean };

type CIOutcome =
  | { status: "success"; text: string; durationMs: number }
  | { status: "timeout"; durationMs: number }
  | { status: "empty"; durationMs: number }
  | { status: "error"; durationMs: number; error: string };

function createAbortRunner(abortSignal?: AbortSignal) {
  return async function runWithAbort<T>(factory: () => Promise<T>): Promise<{ value?: T; cancelled?: boolean }> {
    if (!abortSignal) {
      const value = await factory();
      return { value };
    }
    if (abortSignal.aborted) {
      return { cancelled: true };
    }
    return await new Promise<{ value?: T; cancelled?: boolean }>((resolve, reject) => {
      let settled = false;
      const onAbort = () => {
        if (settled) return;
        settled = true;
        abortSignal.removeEventListener('abort', onAbort);
        resolve({ cancelled: true });
      };
      abortSignal.addEventListener('abort', onAbort, { once: true });
      const promise = factory();
      promise.then(
        (value) => {
          if (settled) return;
          settled = true;
          abortSignal.removeEventListener('abort', onAbort);
          resolve({ value });
        },
        (err) => {
          if (settled) return;
          settled = true;
          abortSignal.removeEventListener('abort', onAbort);
          reject(err);
        }
      );
    });
  };
}

export async function summarize(params: SummarizeParams): Promise<SummarizeResult> {
  const { message, artifactPaths, analysisContext, onEvent, abortSignal } = params;
  const plan: AnalysisPlan | undefined = analysisContext?.analysisPlan;

  const runWithAbort = createAbortRunner(abortSignal);
  if (abortSignal?.aborted) {
    return { cancelled: true };
  }

  let shouldCI = false;
  let ciReason: string | undefined;
  if (plan && Array.isArray(plan.steps) && plan.steps.some((step: any) => step && typeof step === "object" && step.ci)) {
    shouldCI = true;
    ciReason = "analysis_plan_step";
  } else {
    const ROWS_THRESHOLD = 30;
    for (const p of artifactPaths) {
      const rows = countRowsForHeuristic(p);
      if (rows > ROWS_THRESHOLD) {
        shouldCI = true;
        ciReason = "row_threshold";
        break;
      }
    }
  }

  const ciTimeoutMs = 3 * 60 * 1000;
  let fallbackReason = shouldCI ? "ci_unknown" : "ci_not_required";

  if (shouldCI) {
    emit(onEvent, "summarize:ci:start", {
      reason: ciReason,
      artifacts: artifactPaths.length,
      timeoutMs: ciTimeoutMs,
    });
    const raceResult = await runWithAbort(() => attemptCI({ message, artifactPaths, analysisContext, onEvent }, ciTimeoutMs));
    if (raceResult.cancelled) {
      return { cancelled: true };
    }
    const outcome = raceResult.value!;
    switch (outcome.status) {
      case "success":
        emit(onEvent, "summarize:ci:done", {
          durationMs: outcome.durationMs,
          chars: outcome.text.length,
        });
        return { reply: outcome.text };
      case "timeout":
        fallbackReason = "ci_timeout";
        emit(onEvent, "summarize:ci:error", {
          reason: fallbackReason,
          durationMs: outcome.durationMs,
        });
        break;
      case "empty":
        fallbackReason = "ci_empty";
        emit(onEvent, "summarize:ci:error", {
          reason: fallbackReason,
          durationMs: outcome.durationMs,
        });
        break;
      case "error":
        fallbackReason = "ci_error";
        emit(onEvent, "summarize:ci:error", {
          reason: fallbackReason,
          durationMs: outcome.durationMs,
          message: outcome.error,
        });
        break;
    }
  }

  if (abortSignal?.aborted) {
    return { cancelled: true };
  }

  emit(onEvent, "summarize:lightweight:start", {
    reason: fallbackReason,
    artifacts: artifactPaths.length,
  });
  const lightResult = await runWithAbort(() => summarizeLightweight(message, artifactPaths, analysisContext));
  if (lightResult.cancelled) {
    return { cancelled: true };
  }
  const raw = lightResult.value ?? "";
  emit(onEvent, "summarize:lightweight:done", {
    reason: fallbackReason,
    chars: raw?.length ?? 0,
  });
  return { reply: raw };
}

async function attemptCI(
  params: { message: string; artifactPaths: string[]; analysisContext?: any; onEvent?: (ev: { type: string; detail?: any }) => void },
  timeoutMs: number
): Promise<CIOutcome> {
  const started = Date.now();
  try {
    const ciPromise = summarizeWithCI(params);
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
      timeoutHandle = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    });
    const race = await Promise.race([
      ciPromise.then((text) => ({ timedOut: false, text })),
      timeoutPromise,
    ]);
    const durationMs = Date.now() - started;
    if ((race as any).timedOut) {
      return { status: "timeout", durationMs };
    }
    if (timeoutHandle) clearTimeout(timeoutHandle);
    const text = (race as any).text ?? "";
    if (typeof text === "string" && text.trim().length > 0) {
      return { status: "success", text, durationMs };
    }
    return { status: "empty", durationMs };
  } catch (err: any) {
    const durationMs = Date.now() - started;
    return { status: "error", durationMs, error: err?.message || String(err) };
  }
}
