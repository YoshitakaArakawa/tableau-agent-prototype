import { summarizeLightweight, countRowsForHeuristic } from "./lightweight";
import { summarizeWithCI } from "./codeInterpreter";
import type { AnalysisPlan } from "../planning/schemas";

export async function summarize(params: {
  message: string;
  artifactPaths: string[];
  analysisContext?: any;
}): Promise<{ reply: string }>
{
  const { message, artifactPaths, analysisContext } = params;
  const plan = analysisContext?.analysisPlan;
  let shouldCI = false;
  if (plan && Array.isArray(plan.steps)) {
    shouldCI = plan.steps.some((step: any) => step && typeof step === 'object' && step.ci);
  } else {
    const ROWS_THRESHOLD = 30;
    for (const p of artifactPaths) {
      const rows = countRowsForHeuristic(p);
      if (rows > ROWS_THRESHOLD) { shouldCI = true; break; }
    }
  }
  if (shouldCI) {
    const text = await summarizeWithCI({ message, artifactPaths, analysisContext });
    if (text) return { reply: text };
  }
  const raw = summarizeLightweight(message, artifactPaths, analysisContext);
  const narrative = decorateLightweightReply(raw, plan);
  return { reply: narrative };
}

function decorateLightweightReply(raw: string, plan?: AnalysisPlan): string {
  const trimmed = (raw || '').trim();
  const overview = plan?.overview?.trim() || plan?.steps?.[0]?.goal?.trim();
  const actions = extractNextActions(plan);
  const lines: string[] = [];
  if (overview) {
    lines.push(toSentence(`Summary: ${overview}`));
  }
  if (trimmed) {
    if (/unable to/i.test(trimmed)) {
      lines.push(toSentence(trimmed));
    } else {
      lines.push(toSentence(`Key finding: ${trimmed}`));
    }
  }
  if (actions.length) {
    lines.push(toSentence(`Suggested next steps: ${actions.join('; ')}`));
  }
  lines.push('Would you like me to continue with any of these analyses or explore a different angle?');
  return lines.join(' ');
}

function extractNextActions(plan?: AnalysisPlan): string[] {
  if (!plan || !Array.isArray(plan.steps)) return [];
  const out: string[] = [];
  for (const step of plan.steps) {
    if (!step || typeof step !== 'object') continue;
    if (typeof step.goal === 'string' && step.goal.trim()) {
      out.push(step.goal.trim());
    }
    if (out.length >= 3) break;
  }
  return out;
}

function toSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
