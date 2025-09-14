// Minimal preflight checks for environment-based prerequisites.

const { preconditionFailed } = require('./errors');

function requireEnv(keys) {
  const missing = [];
  for (const k of keys) {
    const v = process.env[k];
    if (v === undefined) {
      missing.push(k);
      continue;
    }
    if (typeof v === 'string' && v.trim() === '') {
      missing.push(k);
    }
  }
  return missing;
}

function assertPreflight(checkFn, errorFactory) {
  const missing = checkFn();
  if (missing && missing.length > 0) {
    throw (typeof errorFactory === 'function'
      ? errorFactory(missing)
      : preconditionFailed('Missing prerequisites', {
          required: missing,
          next: 'Set required environment variables and retry.',
        }));
  }
  return true;
}

function preflightTableauMCP() {
  const base = ['TRANSPORT', 'SERVER', 'SITE_NAME', 'PAT_NAME', 'PAT_VALUE'];
  let required = [...base];
  const transport = (process.env.TRANSPORT || '').toLowerCase();
  if (transport === 'stdio') {
    required = [...required, 'TABLEAU_MCP_FILEPATH'];
  }
  return requireEnv(required);
}

function preflightCodeInterpreter() {
  return requireEnv(['OPENAI_API_KEY']);
}

module.exports = {
  requireEnv,
  assertPreflight,
  preflightTableauMCP,
  preflightCodeInterpreter,
};

