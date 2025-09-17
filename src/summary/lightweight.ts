import fs from "fs";
import path from "path";
import { run, user as userMsg, system as systemMsg, extractAllTextOutput } from "@openai/agents";
import type { AnalysisPlan } from "../planning/schemas";
import { buildLightweightSummarizerAgent } from "../agents/lightweightSummarizer";

const JSON_CHAR_LIMIT = Number(process.env.LIGHTWEIGHT_JSON_MAX_CHARS || "8000");

export async function summarizeLightweight(
  message: string,
  artifactPaths: string[],
  ctx?: { analysisPlan?: AnalysisPlan; analysis_plan?: AnalysisPlan }
): Promise<string>
{
  if (!artifactPaths || artifactPaths.length === 0) {
    return "No artifact available for summarization.";
  }

  const artifactPath = artifactPaths[0];
  const resolved = path.resolve(process.cwd(), artifactPath);
  let raw = '';
  try {
    raw = fs.readFileSync(resolved, { encoding: "utf8" });
  } catch (err: any) {
    return `Unable to read artifact ${artifactPath}: ${err?.message || err}`;
  }

  const truncated = raw.length > JSON_CHAR_LIMIT;
  const snippet = truncated ? raw.slice(0, JSON_CHAR_LIMIT) : raw;

  let rowCount: number | undefined;
  try {
    rowCount = countRowsFromJson(JSON.parse(raw));
  } catch {}

  const plan = resolveAnalysisPlan(ctx);
  const agent = buildLightweightSummarizerAgent();
  const messages: any[] = [
    systemMsg(`QUESTION=${message}`),
    systemMsg(`ARTIFACT_PATH=${artifactPath}`),
    systemMsg(`ARTIFACT_JSON_SNIPPET=${snippet}`),
  ];
  if (plan) {
    messages.splice(1, 0, systemMsg(`ANALYSIS_PLAN_JSON=${JSON.stringify(plan)}`));
  }
  if (typeof rowCount === "number") {
    messages.push(systemMsg(`ARTIFACT_ROW_COUNT=${rowCount}`));
  }
  if (truncated) {
    messages.push(systemMsg("ARTIFACT_TRUNCATED=true"));
  }
  messages.push(userMsg("Produce the markdown summary following the requested structure."));

  try {
    const res = await run(agent, messages);
    const output = (typeof (res as any)?.finalOutput === "string" && (res as any).finalOutput)
      ? (res as any).finalOutput
      : extractAllTextOutput((res as any).output);
    if (typeof output === "string" && output.trim().length > 0) {
      return output.trim();
    }
    return fallbackSummary(rowCount);
  } catch (err: any) {
    return fallbackSummary(rowCount, err?.message || String(err || 'unknown_error'));
  }
}

function fallbackSummary(rowCount?: number, error?: string): string {
  const lines: string[] = ["## Year-over-Year Overview", "- Unable to generate an automated summary."];
  lines.push("\n## Key Drivers", "- No driver analysis available.");
  lines.push("\n## Notes");
  if (typeof rowCount === "number") {
    lines.push(`- Rows analysed (approx.): ${rowCount}`);
  }
  if (error) {
    lines.push(`- Lightweight summarizer error: ${error}`);
  } else {
    lines.push("- Lightweight summarizer returned no content.");
  }
  return lines.join("\n");
}

function resolveAnalysisPlan(ctx: any): AnalysisPlan | undefined {
  if (!ctx) return undefined;
  if (ctx.analysisPlan && typeof ctx.analysisPlan === "object") return ctx.analysisPlan;
  if (ctx.analysis_plan && typeof ctx.analysis_plan === "object") return ctx.analysis_plan;
  return undefined;
}

export function countRowsForHeuristic(p: string): number {
  const json = tryReadJson(p);
  return countRowsFromJson(json);
}

function countRowsFromJson(json: any): number {
  try {
    if (Array.isArray(json?.rows)) return json.rows.length;
    if (Array.isArray(json?.data)) return json.data.length;
    if (Array.isArray(json)) return json.length;
  } catch {}
  return 0;
}

function tryReadJson(p: string): any {
  try {
    const full = path.resolve(process.cwd(), p);
    const raw = fs.readFileSync(full, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
