const { randomUUID } = require('crypto');

function timestamp() {
  return new Date().toISOString();
}

function createLogger(traceId) {
  const id = traceId || randomUUID();
  const base = (level, msg, ...args) => {
    const prefix = `[${timestamp()}] [${id}] [${level.toUpperCase()}]`;
    // eslint-disable-next-line no-console
    console.log(prefix, msg, ...args);
  };
  return {
    traceId: id,
    info: (msg, ...args) => base('info', msg, ...args),
    warn: (msg, ...args) => base('warn', msg, ...args),
    error: (msg, ...args) => base('error', msg, ...args),
  };
}

module.exports = { createLogger };

