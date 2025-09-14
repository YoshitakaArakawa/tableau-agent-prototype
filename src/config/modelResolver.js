const fs = require('fs');
const path = require('path');
const { z } = require('zod');

const ModelsConfigSchema = z.object({
  default: z.string().min(1, 'config.default must be a non-empty string'),
  agents: z.record(z.string()).default({}),
});

function loadModelsConfig() {
  const configPath = path.resolve(process.cwd(), 'config', 'models.json');
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch (err) {
    const e = new Error(`Failed to read model config at ${configPath}: ${err.message}`);
    e.cause = err;
    throw e;
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    const e = new Error(`Invalid JSON in ${configPath}: ${err.message}`);
    e.cause = err;
    throw e;
  }
  const parsed = ModelsConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `models.json validation failed: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`
    );
  }
  return parsed.data;
}

function resolveModel(agentName) {
  const cfg = loadModelsConfig();
  if (agentName && cfg.agents && Object.prototype.hasOwnProperty.call(cfg.agents, agentName)) {
    return cfg.agents[agentName];
  }
  return cfg.default;
}

module.exports = {
  loadModelsConfig,
  resolveModel,
};

