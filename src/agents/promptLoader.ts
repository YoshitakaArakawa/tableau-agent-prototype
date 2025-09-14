// Prompt loader for agent instruction XML files.
// - Default directory: <repo>/prompts
// - Override via env PROMPTS_PATH
// - Strict mode by default (PROMPTS_STRICT=true) — throws if not found
// - Optional dev reload (PROMPTS_DEV_RELOAD=true) bypasses cache

import fs from "fs";
import path from "path";

const cache = new Map<string, string>();

function promptsDir(): string {
  const p = process.env.PROMPTS_PATH;
  if (p && p.trim().length > 0) return path.resolve(p);
  return path.resolve(process.cwd(), "prompts");
}

export function loadPrompt(agentName: string, fallback?: string): string {
  const preferReload = String(process.env.PROMPTS_DEV_RELOAD || "").toLowerCase() === "true";
  const strict = String(process.env.PROMPTS_STRICT ?? "true").toLowerCase() === "true";
  const filePath = path.join(promptsDir(), `${agentName}.xml`);
  if (!preferReload && cache.has(filePath)) {
    return cache.get(filePath)!;
  }
  try {
    const txt = fs.readFileSync(filePath, "utf8");
    const cleaned = txt.replace(/^\uFEFF/, "").trim(); // strip BOM and trim
    if (cleaned.length > 0) {
      cache.set(filePath, cleaned);
      return cleaned;
    }
  } catch (e) {
    if (strict) {
      const err = new Error(`Prompt XML not found or unreadable for ${agentName}: ${filePath}`);
      (err as any).cause = e;
      throw err;
    }
    // non-strict: ignore and fall back
  }
  if (typeof fallback === "string" && fallback.length > 0) {
    if (!preferReload) cache.set(filePath, fallback);
    return fallback;
  }
  throw new Error(`No prompt available for ${agentName}. Missing XML file ${filePath} and no fallback provided.`);
}

