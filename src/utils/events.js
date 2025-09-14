const { appendFileSync, mkdirSync } = require('fs');
const { dirname, resolve } = require('path');
const { createLogger } = require('./logger');
const { formatEventMessage } = require('../i18n/messages');

function ensureDir(filePath) {
  try { mkdirSync(dirname(resolve(filePath)), { recursive: true }); } catch {}
}

function writeLine(filePath, line) {
  try { ensureDir(filePath); appendFileSync(filePath, line + '\n', 'utf8'); } catch {}
}

function isoNow() { return new Date().toISOString(); }

// Emits event to callback and appends minimal analysis log.
function safeEmit(cb, ev, logger) {
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
function renderMessage(ev) {
  try { return formatEventMessage(ev?.type, ev?.detail); } catch { return ''; }
}

// Optional: write rendered messages to a file for debugging.
function appendRenderedMessage(ev, filePath) {
  const msg = renderMessage(ev);
  if (!msg) return;
  const line = `${isoNow()} ${msg}`;
  writeLine(filePath || 'logs/pseudo_stream.txt', line);
}

module.exports = {
  safeEmit,
  renderMessage,
  appendRenderedMessage,
};

