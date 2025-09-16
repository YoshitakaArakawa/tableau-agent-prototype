// Model resolver for Agents SDK-based agents.
// Reads config/models.json and resolves per-agent model names with a fallback to default.

import fs from "fs";
import path from "path";

type AgentModelEntry =
  | string
  | {
      model?: string;
      modelSettings?: Record<string, any>;
    };

type ModelsConfig = {
  default: string;
  agents?: Record<string, AgentModelEntry>;
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
    const normalizedAgents: Record<string, AgentModelEntry> = {};
    const agentsRaw = parsed.agents && typeof parsed.agents === "object" ? parsed.agents : {};
    for (const [name, entry] of Object.entries(agentsRaw as Record<string, unknown>)) {
      if (typeof entry === "string") {
        normalizedAgents[name] = entry.trim();
        continue;
      }
      if (entry && typeof entry === "object") {
        const model = typeof (entry as any).model === "string" && (entry as any).model.trim().length > 0 ? (entry as any).model : undefined;
        const settings = (entry as any).modelSettings && typeof (entry as any).modelSettings === "object" ? (entry as any).modelSettings : undefined;
        normalizedAgents[name] = { model, modelSettings: settings };
      }
    }
    cachedConfig = { default: parsed.default, agents: normalizedAgents } as ModelsConfig;
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
  return getAgentModelConfig(agentName).model;
}

export function getModelsConfig(): ModelsConfig {
  return readConfig();
}

export function getModelSettingsForAgent(agentName?: string): Record<string, any> | undefined {
  return getAgentModelConfig(agentName).modelSettings;
}

export function getAgentModelConfig(agentName?: string): { model: string; modelSettings?: Record<string, any> } {
  const cfg = readConfig();
  const fallback = cfg.default;
  let model = fallback;
  let modelSettings: Record<string, any> | undefined;
  if (agentName && cfg.agents && agentName in cfg.agents) {
    const entry = cfg.agents[agentName];
    if (typeof entry === "string" && entry.trim().length > 0) {
      model = entry.trim();
    } else if (entry && typeof entry === "object") {
      const obj = entry as { model?: string; modelSettings?: Record<string, any> };
      if (typeof obj.model === "string" && obj.model.trim().length > 0) {
        model = obj.model.trim();
      }
      if (obj.modelSettings && typeof obj.modelSettings === "object") {
        modelSettings = obj.modelSettings;
      }
    }
  }
  return { model, modelSettings };
}
