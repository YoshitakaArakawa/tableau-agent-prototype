// Common error helpers with a compact, consistent user-facing format.

export const CODES = {
  bad_request: 'bad_request',
  unauthenticated: 'unauthenticated',
  unauthorized: 'unauthorized',
  precondition_failed: 'precondition_failed',
  dependency_failed: 'dependency_failed',
  timeout: 'timeout',
  internal: 'internal',
};

function toArray(val: any): any[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

export type AppError = Error & {
  code?: string;
  required?: string[];
  next?: string;
  details?: any;
  traceId?: string;
};

export function createError(code?: string, cause?: any, opts: { required?: string[]|string; next?: string; details?: any; traceId?: string } = {}): AppError {
  const err: AppError = new Error(typeof cause === 'string' ? cause : (cause && cause.message) || String(cause)) as AppError;
  err.code = code || CODES.internal;
  if (opts.required !== undefined) err.required = toArray(opts.required) as string[];
  if (opts.next !== undefined) err.next = opts.next;
  if (opts.details !== undefined) err.details = opts.details;
  if (opts.traceId !== undefined) err.traceId = opts.traceId;
  return err;
}

// Shortcuts
export const badRequest = (cause?: any, opts?: any) => createError(CODES.bad_request, cause, opts);
export const unauthenticated = (cause?: any, opts?: any) => createError(CODES.unauthenticated, cause, opts);
export const unauthorized = (cause?: any, opts?: any) => createError(CODES.unauthorized, cause, opts);
export const preconditionFailed = (cause?: any, opts?: any) => createError(CODES.precondition_failed, cause, opts);
export const dependencyFailed = (cause?: any, opts?: any) => createError(CODES.dependency_failed, cause, opts);
export const timeout = (cause?: any, opts?: any) => createError(CODES.timeout, cause, opts);
export const internal = (cause?: any, opts?: any) => createError(CODES.internal, cause, opts);

export function formatForUser(err: any): string {
  const cause = (err && (err.cause || err.message)) ? (err.cause || err.message) : String(err);
  const required = err && err.required && err.required.length ? err.required.join(', ') : '-';
  const next = (err && err.next) ? err.next : 'Provide missing inputs or fix the cause, then retry.';
  return `Cause: ${cause}\nRequired Input: ${required}\nNext Action: ${next}`;
}

export function logWithDetails(logger: any, err: AppError) {
  if (!logger || typeof logger.error !== 'function') return;
  const base = {
    code: err && err.code,
    message: err && err.message,
    required: err && err.required,
    next: err && err.next,
    traceId: err && err.traceId,
  };
  logger.error('Error details', base);
  if (err && err.details) {
    logger.error('Error extra details', err.details);
  }
}

export default { CODES, createError, badRequest, unauthenticated, unauthorized, preconditionFailed, dependencyFailed, timeout, internal, formatForUser, logWithDetails };
