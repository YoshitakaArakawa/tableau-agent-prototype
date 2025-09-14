// Event message templates for pseudo-streaming UI.
// Keep content concise; actual UI can render these strings as-is.

const templates: Record<string, Record<string, any>> = {
  en: {
    'triage:start': 'Analyzing intent…',
    'triage:done': ({ limit }: any = {}) => `Intent analyzed${Number.isFinite(limit) ? ` (limit=${limit})` : ''}.`,
    'metadata:start': 'Fetching metadata…',
    'metadata:done': ({ count }: any = {}) => `Metadata fetched${Number.isFinite(count) ? ` (${count} fields)` : ''}.`,
    'selector:start': ({ max }: any = {}) => `Selecting fields${Number.isFinite(max) ? ` (max=${max})` : ''}…`,
    'selector:done': ({ selected, fields }: any = {}) => {
      const prefix = `Field selection complete${Number.isFinite(selected) ? ` (${selected})` : ''}`;
      if (Array.isArray(fields) && fields.length) return `${prefix}: ${fields.slice(0, 6).join(', ')}`;
      return `${prefix}.`;
    },
    'fetch:start': 'Executing VizQL query…',
    'fetch:done': ({ summary }: any = {}) => `Query done${summary ? ` (${String(summary).slice(0, 160)})` : ''}.`,
    'summarize:start': 'Summarizing results…',
    final: 'Answer is ready.',
    error: ({ message }: any = {}) => `Error: ${message ? String(message) : 'unknown'}`,
  },
};

function getLocale(): string {
  const v = String(process.env.LOCALE || 'en').toLowerCase();
  return templates[v] ? v : 'en';
}

export function formatEventMessage(type?: string, detail?: any): string {
  const locale = getLocale();
  const dict = templates[locale] || templates.en;
  const tmpl = type ? dict[type] : undefined;
  if (!tmpl) return '';
  if (typeof tmpl === 'function') return tmpl(detail || {});
  return String(tmpl);
}

export default { formatEventMessage };
