// Minimal preflight checks for environment-based prerequisites.

import { preconditionFailed } from './errors';

export function requireEnv(keys: string[]): string[] {
  const missing = [];
  for (const k of keys) {
    const v = process.env[k as keyof NodeJS.ProcessEnv];
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

export function assertPreflight(checkFn: () => string[], errorFactory?: (missing: string[]) => Error) {
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

export function preflightTableauMCP(): string[] {
  const base = ['TRANSPORT', 'SERVER', 'SITE_NAME', 'PAT_NAME', 'PAT_VALUE'];
  let required = [...base];
  const transport = (process.env.TRANSPORT || '').toLowerCase();
  if (transport === 'stdio') {
    required = [...required, 'TABLEAU_MCP_FILEPATH'];
  }
  return requireEnv(required);
}

export function preflightCodeInterpreter(): string[] {
  return requireEnv(['OPENAI_API_KEY']);
}

export default { requireEnv, assertPreflight, preflightTableauMCP, preflightCodeInterpreter };
