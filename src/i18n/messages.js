// Event message templates for pseudo-streaming UI.
// Keep content concise; actual UI can render these strings as-is.

const templates = {
  en: {
    'triage:start': 'Analyzing intent…',
    'triage:done': ({ limit } = {}) => `Intent analyzed${Number.isFinite(limit) ? ` (limit=${limit})` : ''}.`,
    'metadata:start': 'Fetching metadata…',
    'metadata:done': ({ count } = {}) => `Metadata fetched${Number.isFinite(count) ? ` (${count} fields)` : ''}.`,
    'selector:start': ({ max } = {}) => `Selecting fields${Number.isFinite(max) ? ` (max=${max})` : ''}…`,
    'selector:done': ({ selected, fields } = {}) => {
      const prefix = `Field selection complete${Number.isFinite(selected) ? ` (${selected})` : ''}`;
      if (Array.isArray(fields) && fields.length) return `${prefix}: ${fields.slice(0, 6).join(', ')}`;
      return `${prefix}.`;
    },
    'fetch:start': 'Executing VizQL query…',
    'fetch:done': ({ summary } = {}) => `Query done${summary ? ` (${String(summary).slice(0, 160)})` : ''}.`,
    'summarize:start': 'Summarizing results…',
    final: 'Answer is ready.',
    error: ({ message } = {}) => `Error: ${message ? String(message) : 'unknown'}`,
  },
};

function getLocale() {
  const v = String(process.env.LOCALE || 'en').toLowerCase();
  return templates[v] ? v : 'en';
}

function formatEventMessage(type, detail) {
  const locale = getLocale();
  const dict = templates[locale] || templates.en;
  const tmpl = dict[type];
  if (!tmpl) return '';
  if (typeof tmpl === 'function') return tmpl(detail || {});
  return String(tmpl);
}

module.exports = {
  formatEventMessage,
};

