#!/usr/bin/env node
/*
 Phase 1 runner skeleton:
 - Parses CLI args (--agent, --trace, --help)
 - Resolves model using config/models.json (no hardcoding)
 - Initializes basic logger with a trace ID
 - Prints a short session header to confirm wiring
*/

import { loadEnv } from './config/loadEnv';
import { resolveModel, loadModelsConfig } from './config/modelResolver';
import { createLogger } from './utils/logger';

function parseArgs(argv: string[]) {
  const args: any = { _: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.help = true;
    } else if (a === '--agent' || a === '-a') {
      args.agent = argv[i + 1];
      i += 1;
    } else if (a === '--message' || a === '-m') {
      args.message = argv[i + 1];
      i += 1;
    } else if (a === '--ds' || a === '--datasource' || a === '-d') {
      args.ds = argv[i + 1];
      i += 1;
    } else if (a === '--limit' || a === '-l') {
      const n = Number(argv[i + 1]);
      args.limit = Number.isFinite(n) ? n : undefined;
      i += 1;
    } else if (a === '--demo-orchestrator') {
      args.demoOrchestrator = true;
    } else if (a === '--trace' || a === '-t') {
      args.trace = argv[i + 1];
      i += 1;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function printUsage() {
  // eslint-disable-next-line no-console
  console.log(
    'Usage: node src/runner.js --agent <agent-name> [--trace <trace-id>] [--demo-events]\n' +
      '   or: node src/runner.js --demo-orchestrator --message <text> --ds <datasourceLuid> [--limit <n>] [--trace <id>]\n' +
      'Resolves the model from config/models.json and initializes a session skeleton or runs a demo orchestrator.'
  );
}

export async function main() {
  // Load .env into process.env (if present). No network or external deps.
  loadEnv('.env');
  const args = parseArgs(process.argv);
  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const agentName = args.agent;

  const logger = createLogger(args.trace);
  const traceId = logger.traceId;

  try {
    if (args.demoOrchestrator) {
      const { orchestrate } = await import('./orchestrator/orchestrator');
      const message = args.message;
      const ds = args.ds || process.env.FIXED_DATASOURCE_LUID || process.env.DATASOURCE_LUID;
      if (!message || !ds) {
        // eslint-disable-next-line no-console
        console.error('Error: --demo-orchestrator requires --message and --ds (or env FIXED_DATASOURCE_LUID).');
        printUsage();
        process.exit(2);
      }
      logger.info('Demo orchestrator start');
      const { renderMessage, safeEmit } = await import('./utils/events');
      const onEvent = (ev) => {
        const msg = renderMessage(ev);
        if (msg) console.log('-', msg);
        else console.log('-', ev.type);
        safeEmit(() => {}, ev, logger);
      };
      const res = await orchestrate({ message, datasourceLuid: ds, limit: args.limit, onEvent, logger });
      console.log('\nFinal reply:\n' + (res.reply || ''));
      process.exit(0);
    }

    if (!agentName) {
      // Explicit error per execution policy (no silent fallback)
      // eslint-disable-next-line no-console
      console.error('Error: --agent <agent-name> is required.');
      printUsage();
      process.exit(2);
    }

    // Load once to fail fast if invalid
    const config = loadModelsConfig();
    const model = resolveModel(agentName);

    logger.info('Session start');
    logger.info(`Agent: ${agentName}`);
    logger.info(`Resolved model: ${model}`);
    logger.info('Status: ready (Phase 1 skeleton)');

    // Print a compact summary for tooling
    console.log('\n---');
    console.log('traceId:', traceId);
    console.log('agent:', agentName);
    console.log('model:', model);
    console.log('configDefault:', config.default);

    if (args._.includes('--demo-events') || args.demo || args['demo-events']) {
      // Emit a short fixed sequence of events and render pseudo-stream messages to console.
      const { safeEmit, renderMessage } = require('./utils/events');
      const sequence = [
        { type: 'triage:start', detail: { message: 'avg sales by year' } },
        { type: 'triage:done', detail: { limit: 50 } },
        { type: 'metadata:start' },
        { type: 'metadata:done', detail: { count: 42 } },
        { type: 'selector:start', detail: { max: 8 } },
        { type: 'selector:done', detail: { selected: 3, fields: ['Sales(SUM)', 'Year', 'Category'] } },
        { type: 'fetch:start' },
        { type: 'fetch:done', detail: { summary: 'rows=120 artifact=vds/2025-09-14T00-00-00.json' } },
        { type: 'summarize:start' },
        { type: 'final' },
      ];
      console.log('\nPseudo-stream messages:');
      for (const ev of sequence) {
        safeEmit(() => {}, ev, logger);
        const msg = renderMessage(ev);
        if (msg) console.log('-', msg);
      }
    }
  } catch (err) {
    logger.error('Initialization failed:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e?.message || e); process.exit(1); });
}

export default { main };

module.exports = { main };
