// Common error helpers with a compact, consistent user-facing format.

const CODES = {
  bad_request: 'bad_request',
  unauthenticated: 'unauthenticated',
  unauthorized: 'unauthorized',
  precondition_failed: 'precondition_failed',
  dependency_failed: 'dependency_failed',
  timeout: 'timeout',
  internal: 'internal',
};

function toArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function createError(code, cause, opts = {}) {
  const err = new Error(typeof cause === 'string' ? cause : (cause && cause.message) || String(cause));
  err.code = code || CODES.internal;
  if (opts.required !== undefined) err.required = toArray(opts.required);
  if (opts.next !== undefined) err.next = opts.next;
  if (opts.details !== undefined) err.details = opts.details;
  if (opts.traceId !== undefined) err.traceId = opts.traceId;
  return err;
}

// Shortcuts
const badRequest = (cause, opts) => createError(CODES.bad_request, cause, opts);
const unauthenticated = (cause, opts) => createError(CODES.unauthenticated, cause, opts);
const unauthorized = (cause, opts) => createError(CODES.unauthorized, cause, opts);
const preconditionFailed = (cause, opts) => createError(CODES.precondition_failed, cause, opts);
const dependencyFailed = (cause, opts) => createError(CODES.dependency_failed, cause, opts);
const timeout = (cause, opts) => createError(CODES.timeout, cause, opts);
const internal = (cause, opts) => createError(CODES.internal, cause, opts);

function formatForUser(err) {
  const cause = (err && (err.cause || err.message)) ? (err.cause || err.message) : String(err);
  const required = err && err.required && err.required.length ? err.required.join(', ') : '-';
  const next = (err && err.next) ? err.next : 'Provide missing inputs or fix the cause, then retry.';
  return `Cause: ${cause}\nRequired Input: ${required}\nNext Action: ${next}`;
}

function logWithDetails(logger, err) {
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

module.exports = {
  CODES,
  createError,
  badRequest,
  unauthenticated,
  unauthorized,
  preconditionFailed,
  dependencyFailed,
  timeout,
  internal,
  formatForUser,
  logWithDetails,
};

