// Model resolver for Agents SDK-based agents.
// Reads config/models.json and resolves per-agent model names with a fallback to default.

import fs from "fs";
import path from "path";

type ModelsConfig = {
  default: string;
  agents?: Record<string, string>;
};

let cachedConfig: ModelsConfig | null = null;
let cachedMtimeMs = 0;

function configPath(): string {
  return path.resolve(process.cwd(), "config", "models.json");
}

function readConfig(): ModelsConfig {
  const file = configPath();
  try {
    const stat = fs.statSync(file);
    const preferReload = String(process.env.MODELS_DEV_RELOAD || "").toLowerCase() === "true";
    if (!preferReload && cachedConfig && cachedMtimeMs === stat.mtimeMs) {
      return cachedConfig;
    }
    const raw = fs.readFileSync(file, { encoding: "utf8" });
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.default !== "string") {
      throw new Error("models.json must include a string 'default' and optional 'agents' map");
    }
    cachedConfig = { default: parsed.default, agents: parsed.agents || {} } as ModelsConfig;
    cachedMtimeMs = stat.mtimeMs;
    return cachedConfig;
  } catch (e: any) {
    const msg = e?.message || String(e);
    const err = new Error(`Failed to read model configuration at ${file}: ${msg}`);
    (err as any).cause = e;
    throw err;
  }
}

export function getModelForAgent(agentName?: string): string {
  const cfg = readConfig();
  if (agentName && cfg.agents && typeof cfg.agents[agentName] === "string" && cfg.agents[agentName]!.length > 0) {
    return cfg.agents[agentName]!;
  }
  return cfg.default;
}

export function getModelsConfig(): ModelsConfig {
  return readConfig();
}

