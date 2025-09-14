function getBool(name: string, def = false): boolean {
  const v = String(process.env[name] ?? '').toLowerCase();
  if (!v) return def;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function getNum(name: string, def?: number): number | undefined {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : def;
}

export function buildContext() {
  return {
    plannerTimeoutMs: getNum('PLANNER_TIMEOUT_MS', 30000),
    fetchTimeoutMs: getNum('TABLEAU_CLIENT_TIMEOUT_MS', 15000),
    streamingEnabled: getBool('AGENTS_STREAMING_ENABLED', false),
  };
}
export default { buildContext };
