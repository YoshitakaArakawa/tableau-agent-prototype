// Minimal agent registry for Phase 1 (TypeScript)
const registry = new Map<string, any>();

export function registerAgent(name: string, config: any) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('Agent name must be a non-empty string');
  }
  registry.set(name, Object.assign({}, config, { name }));
}

export function getAgent(name: string) {
  return registry.get(name);
}

export function listAgents() {
  return Array.from(registry.keys());
}

export default { registerAgent, getAgent, listAgents };
