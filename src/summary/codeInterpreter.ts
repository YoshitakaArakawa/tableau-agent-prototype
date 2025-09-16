// Minimal Responses API client for Code Interpreter (auto container + file_ids).
// No extra dependencies; uses global fetch and FormData.

import fs from "fs";
import path from "path";
import { loadPrompt } from "../agents/promptLoader";
import { getAgentModelConfig } from "../model/resolveModels";
import type { AnalysisPlan } from "../planning/schemas";

type CIParams = {
  message: string;
  artifactPaths: string[];
  analysisContext?: any;
};

async function uploadFile(filePath: string, apiKey: string, baseUrl: string): Promise<string> {
  const url = `${baseUrl}/v1/files`;
  const ab = await fs.promises.readFile(path.resolve(process.cwd(), filePath));
  const arrayBuffer = new ArrayBuffer(ab.length);
  new Uint8Array(arrayBuffer).set(ab);
  const blob = new Blob([arrayBuffer]);
  const form = new FormData();
  form.append('file', blob, path.basename(filePath));
  form.append('purpose', 'assistants');
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form as any,
  } as any);
  if (!resp.ok) throw new Error(`file_upload_failed status=${resp.status}`);
  const json: any = await resp.json();
  return json?.id || json?.data?.id;
}

async function deleteFile(fileId: string, apiKey: string, baseUrl: string): Promise<void> {
  try {
    const url = `${baseUrl}/v1/files/${fileId}`;
    await fetch(url, { method: 'DELETE', headers: { 'Authorization': `Bearer ${apiKey}` } });
  } catch {}
}

export async function summarizeWithCI(params: CIParams): Promise<string> {
  const { message, artifactPaths, analysisContext } = params;
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) return '';
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
  const { model } = getAgentModelConfig('analyst');

  // Upload files
  const fileIds: string[] = [];
  for (const p of artifactPaths) {
    try { const id = await uploadFile(p, apiKey, baseUrl); if (id) fileIds.push(id); } catch {}
  }
  if (fileIds.length === 0) return '';

  let instructions = '';
  try { instructions = loadPrompt('analyst'); } catch { instructions = 'You are a data analyst. Read the provided JSON files and answer succinctly.'; }

  const plan = resolveAnalysisPlan(analysisContext);
  const extraContext: Record<string, unknown> = {};
  try {
    const ac = analysisContext as any;
    if (ac?.notes) extraContext.notes = ac.notes;
    if (ac?.analysisBrief) extraContext.analysisBrief = ac.analysisBrief;
  } catch {}
  const inputParts: string[] = [
    `QUESTION=${message}`,
    `ARTIFACT_PATHS_JSON=${JSON.stringify(artifactPaths)}`,
  ];
  if (plan) {
    inputParts.push(`ANALYSIS_PLAN_JSON=${JSON.stringify(plan)}`);
    if (plan.metrics && plan.metrics.length) {
      extraContext.metrics = plan.metrics;
    }
    if (plan.segments && plan.segments.length) {
      extraContext.segments = plan.segments;
    }
  }
  if (Object.keys(extraContext).length > 0) {
    inputParts.push(`OPTIONAL_CONTEXT=${JSON.stringify(extraContext)}`);
  }
  const input = inputParts.join('\n');

  const resp = await fetch(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      tools: [ { type: 'code_interpreter', container: { type: 'auto', file_ids: fileIds } } ],
      instructions,
      input,
    }),
  });
  if (!resp.ok) {
    // best-effort cleanup
    const del = String(process.env.CI_DELETE_FILE_AFTER ?? 'true').toLowerCase() !== 'false';
    if (del) for (const id of fileIds) { await deleteFile(id, apiKey, baseUrl); }
    return '';
  }
  const json: any = await resp.json();

  // Cleanup
  const del = String(process.env.CI_DELETE_FILE_AFTER ?? 'true').toLowerCase() !== 'false';
  if (del) for (const id of fileIds) { await deleteFile(id, apiKey, baseUrl); }

  // Extract text
  let outputText = json?.output_text || '';
  if (!outputText && Array.isArray(json?.output)) {
    const pieces: string[] = [];
    for (const it of json.output) {
      if (it?.type === 'output_text' && typeof it.text === 'string') pieces.push(it.text);
    }
    outputText = pieces.join('\n');
  }
  return typeof outputText === 'string' ? outputText : '';
}

function resolveAnalysisPlan(analysisContext: any): AnalysisPlan | undefined {
  if (!analysisContext) return undefined;
  const direct = (analysisContext as { analysisPlan?: AnalysisPlan }).analysisPlan;
  if (direct && typeof direct === 'object') return direct;
  const snake = (analysisContext as { analysis_plan?: AnalysisPlan }).analysis_plan;
  if (snake && typeof snake === 'object') return snake;
  return undefined;
}
