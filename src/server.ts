#!/usr/bin/env node
// Minimal API server without external deps. Serves frontend and exposes demo endpoints.

import http from 'http';
import fs from 'fs';
import path from 'path';
import url from 'url';
import { loadEnv } from './config/loadEnv';
import { orchestrate } from './orchestrator/orchestrator';
import { renderMessage, safeEmit } from './utils/events';
import { createLogger } from './utils/logger';

loadEnv('.env');

const logger = createLogger();
const port = Number(process.env.PORT || 8787);
const publicDir = path.resolve(process.cwd(), 'frontend');

function send(res: http.ServerResponse, code: number, body: any, headers: Record<string, string> = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ''));
  res.writeHead(code, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, headers));
  res.end(buf);
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const parsed = url.parse(req.url || '/');
  let pathname = parsed.pathname || '/';
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.join(publicDir, pathname);
  // Prevent directory traversal
  const safe = path.resolve(filePath).startsWith(publicDir) ? filePath : null;
  if (!safe) return send(res, 403, 'Forbidden');
  fs.readFile(safe, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    const ext = path.extname(safe).toLowerCase();
    const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
    const ct = types[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct });
    res.end(data);
  });
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk; if (data.length > 1_000_000) { reject(new Error('payload_too_large')); try { req.destroy(); } catch {} }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
  const parsed = url.parse(req.url || '/', true) as url.UrlWithParsedQuery;
  const pathname = parsed.pathname || '/';
  if (req.method === 'GET' && (pathname === '/' || pathname.startsWith('/assets') || pathname.endsWith('.js') || pathname.endsWith('.css') || pathname.endsWith('.html'))) {
    return serveStatic(req, res);
  }
  if (req.method === 'GET' && pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (req.method === 'POST' && pathname === '/api/orchestrate') {
    try {
      const body = await readJson(req);
      const message = String(body.message || '');
      const ds = String(body.datasourceLuid || '');
      const limit = typeof body.limit === 'number' ? body.limit : undefined;
      const events: any[] = [];
      const onEvent = (ev: any) => { try { events.push(ev); } catch {} };
      const out = await orchestrate({ message, datasourceLuid: ds, limit, onEvent, logger });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ reply: out.reply, events }));
    } catch (e: any) {
      logger.error('POST /api/orchestrate failed', e?.message || e);
      return send(res, 500, 'internal_error');
    }
  }
  if (req.method === 'GET' && pathname === '/api/orchestrate/stream') {
    const message = String((parsed.query as any).message || '');
    const ds = String((parsed.query as any).datasourceLuid || '');
    const limit = (parsed.query as any).limit ? Number((parsed.query as any).limit) : undefined;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const writeEv = (ev: any) => { try { res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch {} };
    const onEvent = (ev: any) => {
      writeEv(ev);
      const msg = renderMessage(ev);
      if (msg) writeEv({ type: 'message', detail: { text: msg } });
      safeEmit(() => {}, ev, logger);
    };
    orchestrate({ message, datasourceLuid: ds, limit, onEvent, logger })
      .then(() => { try { res.end(); } catch {} })
      .catch((e: any) => { writeEv({ type: 'error', detail: { message: e?.message || String(e) } }); try { res.end(); } catch {} });
    return;
  }
  return send(res, 404, 'Not found');
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${port}`);
});
