import { appendFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { createLogger } from './logger';
import { formatEventMessage } from '../i18n/messages';

function ensureDir(filePath: string) {
  try { mkdirSync(dirname(resolve(filePath)), { recursive: true }); } catch {}
}

function writeLine(filePath: string, line: string) {
  try { ensureDir(filePath); appendFileSync(filePath, line + '\n', 'utf8'); } catch {}
}

function isoNow(): string { return new Date().toISOString(); }

// Emits event to callback and appends minimal analysis log.
export function safeEmit(cb: ((ev: any) => void) | undefined, ev: any, logger?: any) {
  try { if (typeof cb === 'function') cb(ev); } catch {}
  try {
    const lg = logger || createLogger();
    if (ev && typeof ev.type === 'string') {
      const detail = ev.detail ? JSON.stringify(ev.detail) : '';
      lg.info(`[event] ${ev.type}${detail ? ` detail=${detail}` : ''}`);
    }
  } catch {}
}

// Convenience: render a human message for UI from event type/detail.
export function renderMessage(ev: any): string {
  try { return formatEventMessage(ev?.type, ev?.detail); } catch { return ''; }
}

// Optional: write rendered messages to a file for debugging.
export function appendRenderedMessage(ev: any, filePath?: string) {
  const msg = renderMessage(ev);
  if (!msg) return;
  const line = `${isoNow()} ${msg}`;
  writeLine(filePath || 'logs/pseudo_stream.txt', line);
}
export default { safeEmit, renderMessage, appendRenderedMessage };
