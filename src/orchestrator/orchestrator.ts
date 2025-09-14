import { assertPreflight, preflightTableauMCP } from '../utils/preflight';
import { safeEmit } from '../utils/events';
import { formatForUser, preconditionFailed } from '../utils/errors';
import { buildContext } from './context';

export async function orchestrate(params: { message: string; datasourceLuid: string; limit?: number; onEvent?: (ev: any) => void; logger?: any }) {
  const { message, datasourceLuid, limit, onEvent, logger } = params || {};
  try {
    if (!message || typeof message !== 'string') {
      throw preconditionFailed('message is required', { required: ['message'], next: 'Pass a non-empty message string.' });
    }
    if (!datasourceLuid || typeof datasourceLuid !== 'string') {
      throw preconditionFailed('datasourceLuid is required', { required: ['datasourceLuid'], next: 'Provide a Tableau datasource LUID.' });
    }

    // Preflight: environment for Tableau MCP
    try {
      assertPreflight(preflightTableauMCP);
    } catch (e) {
      safeEmit(onEvent, { type: 'error', detail: { message: formatForUser(e) } }, logger);
      return { reply: formatForUser(e) };
    }

    const ctx = buildContext();
    safeEmit(onEvent, { type: 'triage:start', detail: { message, limit } }, logger);
    // Phase: triage (skeleton)
    const decision = { needsData: true, needsMetadata: true, limit: Number.isFinite(limit) ? limit : 50 };
    safeEmit(onEvent, { type: 'triage:done', detail: { limit: decision.limit } }, logger);

    // Phase: metadata
    if (decision.needsMetadata) {
      safeEmit(onEvent, { type: 'metadata:start' }, logger);
      // skeleton: not fetching yet
      const normalizedCount = 0; // placeholder
      safeEmit(onEvent, { type: 'metadata:done', detail: { count: normalizedCount } }, logger);
    }

    // Phase: field selector
    safeEmit(onEvent, { type: 'selector:start', detail: { max: 8 } }, logger);
    const allowed = ['Sales(SUM)', 'Year'];
    safeEmit(onEvent, { type: 'selector:done', detail: { selected: allowed.length, fields: allowed } }, logger);

    // Phase: compile plan
    safeEmit(onEvent, { type: 'plan:start' }, logger);
    const payload = { query: { fields: [{ fieldCaption: 'Sales', function: 'SUM' }], filters: [] } };
    safeEmit(onEvent, { type: 'plan:done' }, logger);

    // Phase: fetch (skeleton; no MCP call here yet)
    safeEmit(onEvent, { type: 'fetch:start' }, logger);
    safeEmit(onEvent, { type: 'fetch:done', detail: { summary: 'demo rows=0' } }, logger);

    // Phase: summarize
    safeEmit(onEvent, { type: 'summarize:start' }, logger);
    const reply = 'Demo orchestrator completed. Add MCP + Agents to execute.';
    safeEmit(onEvent, { type: 'final', detail: { reply } }, logger);
    return { reply, payload };
  } catch (err) {
    const msg = formatForUser(err);
    safeEmit(onEvent, { type: 'error', detail: { message: msg } }, logger);
    return { reply: msg };
  }
}
export default { orchestrate };
