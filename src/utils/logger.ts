import { randomUUID } from 'crypto';

function timestamp(): string {
  return new Date().toISOString();
}

export function createLogger(traceId?: string) {
  const id = traceId || randomUUID();
  const base = (level: string, msg: any, ...args: any[]) => {
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
export default { createLogger };
