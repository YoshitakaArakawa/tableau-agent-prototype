// Minimal Responses API client for Code Interpreter (auto container + file_ids).
// No extra dependencies; uses global fetch and FormData.

import fs from "fs";
import path from "path";
import { loadPrompt } from "../agents/promptLoader";
import { getAgentModelConfig } from "../model/resolveModels";
import { safeEmit } from "../utils/events";
import type { AnalysisPlan } from "../planning/schemas";

type OrchestratorEvent = { type: string; detail?: any };

type CIParams = {
  message: string;
  artifactPaths: string[];
  analysisContext?: any;
  onEvent?: (ev: OrchestratorEvent) => void;
};

async function uploadFile(
  filePath: string,
  apiKey: string,
  baseUrl: string,
  onEvent?: (ev: OrchestratorEvent) => void
): Promise<string | null> {
  const fullPath = path.resolve(process.cwd(), filePath);
  const stats = await fs.promises.stat(fullPath).catch(() => null);
  if (!stats) {
    safeEmit(onEvent, {
      type: "summarize:ci:upload:error",
      detail: { path: filePath, message: "file_not_found" },
    });
    return null;
  }
  const url = `${baseUrl}/v1/files`;
  const ab = await fs.promises.readFile(fullPath);
  const arrayBuffer = new ArrayBuffer(ab.length);
  new Uint8Array(arrayBuffer).set(ab);
  const blob = new Blob([arrayBuffer]);
  const form = new FormData();
  form.append("file", blob, path.basename(filePath));
  form.append("purpose", "assistants");
  safeEmit(onEvent, {
    type: "summarize:ci:upload:start",
    detail: { path: filePath, sizeBytes: stats.size },
  });
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form as any,
  } as any);
  if (!resp.ok) {
    safeEmit(onEvent, {
      type: "summarize:ci:upload:error",
      detail: { path: filePath, status: resp.status },
    });
    return null;
  }
  const json: any = await resp.json();
  const id = json?.id || json?.data?.id || null;
  safeEmit(onEvent, {
    type: "summarize:ci:upload:done",
    detail: { path: filePath, fileId: id },
  });
  return id;
}

async function deleteFile(fileId: string, apiKey: string, baseUrl: string): Promise<void> {
  try {
    const url = `${baseUrl}/v1/files/${fileId}`;
    await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${apiKey}` } });
  } catch {}
}

export async function summarizeWithCI(params: CIParams): Promise<string> {
  const { message, artifactPaths, analysisContext, onEvent } = params;
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    safeEmit(onEvent, {
      type: "summarize:ci:error",
      detail: { reason: "missing_api_key" },
    });
    return "";
  }
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com";
  const { model } = getAgentModelConfig("analyst");

  const fileIds: string[] = [];
  for (const p of artifactPaths) {
    try {
      const id = await uploadFile(p, apiKey, baseUrl, onEvent);
      if (id) fileIds.push(id);
    } catch (err: any) {
      safeEmit(onEvent, {
        type: "summarize:ci:upload:error",
        detail: { path: p, message: err?.message || String(err) },
      });
    }
  }
  safeEmit(onEvent, {
    type: "summarize:ci:upload:summary",
    detail: { requested: artifactPaths.length, uploaded: fileIds.length },
  });
  if (fileIds.length === 0) return "";

  let instructions = "";
  try {
    instructions = loadPrompt("analyst");
  } catch {
    instructions = "You are a data analyst. Read the provided JSON files and answer succinctly.";
  }

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
  const input = inputParts.join("\n");

  const requestStarted = Date.now();
  safeEmit(onEvent, {
    type: "summarize:ci:request:start",
    detail: { model, files: fileIds.length },
  });
  const resp = await fetch(`${baseUrl}/v1/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      tools: [{ type: "code_interpreter", container: { type: "auto", file_ids: fileIds } }],
      instructions,
      input,
    }),
  });
  const durationMs = Date.now() - requestStarted;
  if (!resp.ok) {
    safeEmit(onEvent, {
      type: "summarize:ci:request:error",
      detail: { status: resp.status, durationMs },
    });
    const del = String(process.env.CI_DELETE_FILE_AFTER ?? "true").toLowerCase() !== "false";
    if (del) for (const id of fileIds) { await deleteFile(id, apiKey, baseUrl); }
    return "";
  }
  const json: any = await resp.json();
  safeEmit(onEvent, {
    type: "summarize:ci:request:done",
    detail: {
      durationMs,
      responseId: json?.id,
      usage: json?.usage,
    },
  });

  const del = String(process.env.CI_DELETE_FILE_AFTER ?? "true").toLowerCase() !== "false";
  if (del) for (const id of fileIds) { await deleteFile(id, apiKey, baseUrl); }

  const trimmed = extractResponseText(json);
  const sanitized = trimmed.replace(/\[([^\]]+)\]\(sandbox:[^)]+\)/g, '$1').trim();
  safeEmit(onEvent, {
    type: "summarize:ci:response",
    detail: { chars: sanitized.length },
  });
  return sanitized;
}

function extractResponseText(json: any): string {
  const pieces: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        pieces.push(trimmed);
      }
    }
  };

  const visit = (node: any): void => {
    if (!node) return;
    if (typeof node === "string") {
      push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const entry of node) {
        visit(entry);
      }
      return;
    }
    push(node?.output_text);
    if ((node?.type === "output_text" || node?.type === "text") && typeof node?.text === "string") {
      push(node.text);
    } else if (typeof node?.text === "string" && !node?.type) {
      push(node.text);
    }
    if (Array.isArray(node?.content)) {
      for (const child of node.content) {
        visit(child);
      }
    }
    if (Array.isArray(node?.output)) {
      for (const child of node.output) {
        visit(child);
      }
    }
    if (node?.response) {
      visit(node.response);
    }
  };

  visit(json);

  const combined = pieces.join("\n").trim();
  return combined;
}

function resolveAnalysisPlan(analysisContext: any): AnalysisPlan | undefined {
  if (!analysisContext) return undefined;
  const direct = (analysisContext as { analysisPlan?: AnalysisPlan }).analysisPlan;
  if (direct && typeof direct === "object") return direct;
  const snake = (analysisContext as { analysis_plan?: AnalysisPlan }).analysis_plan;
  if (snake && typeof snake === "object") return snake;
  return undefined;
}






