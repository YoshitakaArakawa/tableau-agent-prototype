// Minimal agent registry for Phase 1.
// This will be expanded in later phases to include tool wiring and prompts.

const registry = new Map();

function registerAgent(name, config) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('Agent name must be a non-empty string');
  }
  registry.set(name, Object.assign({}, config, { name }));
}

function getAgent(name) {
  return registry.get(name);
}

function listAgents() {
  return Array.from(registry.keys());
}

module.exports = {
  registerAgent,
  getAgent,
  listAgents,
};

