// Minimal Responses API client for Code Interpreter (auto container + file_ids).
// No extra dependencies; uses global fetch and FormData.

import fs from "fs";
import path from "path";
import { loadPrompt } from "../agents/promptLoader";
import { getModelForAgent } from "../model/resolveModels";

type CIParams = {
  message: string;
  artifactPaths: string[];
  analysisContext?: any;
};

async function uploadFile(filePath: string, apiKey: string, baseUrl: string): Promise<string> {
  const url = `${baseUrl}/v1/files`;
  const ab = await fs.promises.readFile(path.resolve(process.cwd(), filePath));
  const blob = new Blob([ab]);
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
  const enabled = String(process.env.SUMMARIZER_CI_ENABLED || '').toLowerCase() === 'true';
  if (!enabled) return '';

  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) return '';
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
  const model = getModelForAgent('analyst');

  // Upload files
  const fileIds: string[] = [];
  for (const p of artifactPaths) {
    try { const id = await uploadFile(p, apiKey, baseUrl); if (id) fileIds.push(id); } catch {}
  }
  if (fileIds.length === 0) return '';

  let instructions = '';
  try { instructions = loadPrompt('analyst'); } catch { instructions = 'You are a data analyst. Read the provided JSON files and answer succinctly.'; }

  const ctxLines: string[] = [];
  try {
    const ac = analysisContext as any;
    if (ac?.goal) ctxLines.push(`Goal: ${ac.goal}`);
    if (Array.isArray(ac?.metrics) && ac.metrics.length) ctxLines.push(`Metrics: ${ac.metrics.join(', ')}`);
  } catch {}
  const input = [ `Question: ${message}`, ...(ctxLines.length ? ['Context:', ...ctxLines] : []) ].join('\n');

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

