import http from 'http';
import fs from 'fs';
import path from 'path';
import { URL } from 'url';
import { orchestrate } from './orchestrator/run';
import { connectTableauMcp } from './mcp/tableau';
import { appendAnalysisLog } from './utils/logger';
import { setTracingDisabled } from '@openai/agents';

// Disable Agents SDK tracing (keep code and logs simple)
setTracingDisabled(true);

const port = process.env.PORT ? Number(process.env.PORT) : 8787;

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const u = new URL(req.url || '/', `http://localhost:${port}`);
    let p = u.pathname;
    if (p === '/' || p === '/index.html') p = '/index.html';
    const filePath = path.resolve(process.cwd(), 'frontend', '.' + p);
    const root = path.resolve(process.cwd(), 'frontend');
    if (!filePath.startsWith(root)) { res.statusCode = 403; return res.end('Forbidden'); }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) { res.statusCode = 404; return res.end('Not Found'); }
    const ext = path.extname(filePath).toLowerCase();
    const ctype = ext === '.html' ? 'text/html; charset=utf-8'
      : ext === '.js' ? 'text/javascript; charset=utf-8'
      : ext === '.css' ? 'text/css; charset=utf-8'
      : 'application/octet-stream';
    res.setHeader('Content-Type', ctype);
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.statusCode = 500; res.end('Internal Server Error');
  }
}

function handleSse(req: http.IncomingMessage, res: http.ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  const u = new URL(req.url || '/', `http://localhost:${port}`);
  const message = String(u.searchParams.get('message') || '');
  const datasourceLuid = String(u.searchParams.get('datasourceLuid') || '');
  const limit = u.searchParams.get('limit') ? Number(u.searchParams.get('limit')) : undefined;
  if (!message || !datasourceLuid) { res.write('data: ' + JSON.stringify({ type: 'error', detail: { message: 'message and datasourceLuid are required' } }) + '\n\n'); return res.end(); }

  const send = (ev: { type: string; detail?: any }) => {
    try { res.write('data: ' + JSON.stringify(ev) + '\n\n'); } catch {}
    try {
      if (ev?.type && !String(ev.type).endsWith(':delta')) {
        const detail = ev?.detail ? JSON.stringify(ev.detail) : '';
        appendAnalysisLog(`orchestrator:event type=${ev.type}${detail ? ' detail=' + detail : ''}`);
      }
    } catch {}
  };

  const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 15000);
  orchestrate({ message, datasourceLuid, limitHint: limit, onEvent: (ev) => send(ev) })
    .then(() => { clearInterval(hb); res.end(); })
    .catch((e) => { clearInterval(hb); send({ type: 'error', detail: { message: e?.message || String(e) } }); res.end(); });

  req.on('close', () => { try { clearInterval(hb); } catch {} });
}

const server = http.createServer(async (req, res) => {
  try {
    const method = (req.method || 'GET').toUpperCase();
    const u = new URL(req.url || '/', `http://localhost:${port}`);
    if (method === 'GET' && (u.pathname === '/chat/orchestrator/stream')) {
      return handleSse(req, res);
    }
    if (method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html' || u.pathname.startsWith('/styles') || u.pathname.startsWith('/main') )) {
      return serveStatic(req, res);
    }
    // Fallback: static
    return serveStatic(req, res);
  } catch (e: any) {
    res.statusCode = 500; res.end(e?.message || 'Internal Error');
  }
});

server.listen(port, async () => {
  console.log(`Agent server listening on http://localhost:${port}`);
  try { appendAnalysisLog(`server:listening url=http://localhost:${port}`); } catch {}
  try { await connectTableauMcp(); console.log('Tableau MCP connected.'); appendAnalysisLog('mcp:connected'); } catch (e: any) { console.warn('MCP connect failed:', e?.message || e); }
});

server.on('error', (err: any) => {
  if (err?.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use.`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});

// Graceful shutdown on Ctrl+C / SIGTERM
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return; shuttingDown = true;
  try { appendAnalysisLog(`server:shutdown signal=${signal}`); } catch {}
  console.log(`\nReceived ${signal}, shutting down...`);
  server.close(async (err) => {
    if (err) {
      console.error('Error during server close:', err);
      try { appendAnalysisLog(`server:shutdown_error message=${err?.message || err}`); } catch {}
      process.exit(1);
    }
    try {
      const { closeTableauMcp } = await import('./mcp/tableau');
      await closeTableauMcp();
      appendAnalysisLog('mcp:closed');
    } catch {}
    console.log('HTTP server closed. Bye.');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
