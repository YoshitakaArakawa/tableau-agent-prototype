import { summarizeLightweight, countRowsForHeuristic } from "./lightweight";
import { summarizeWithCI } from "./codeInterpreter";

export async function summarize(params: {
  message: string;
  artifactPaths: string[];
  analysisContext?: any;
}): Promise<{ reply: string }>
{
  const { message, artifactPaths, analysisContext } = params;
  // Default: CI enabled with a simple heuristic — if any artifact has > 30 rows, use CI.
  const ROWS_THRESHOLD = 30;
  let shouldCI = false;
  for (const p of artifactPaths) {
    const rows = countRowsForHeuristic(p);
    if (rows > ROWS_THRESHOLD) { shouldCI = true; break; }
  }
  if (shouldCI) {
    const text = await summarizeWithCI({ message, artifactPaths, analysisContext });
    if (text) return { reply: text };
  }
  const text = summarizeLightweight(message, artifactPaths, analysisContext);
  return { reply: text };
}
