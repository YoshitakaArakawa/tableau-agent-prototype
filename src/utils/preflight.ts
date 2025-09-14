// Minimal preflight validation for query payloads.
// Returns empty string when OK; otherwise returns a short error key/message.

function isRfc3339Date(s: any): boolean {
  if (typeof s !== 'string' || s.length < 10) return false;
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return false;
  const d = new Date(s);
  return !isNaN(d.getTime());
}

export function preflightValidateQuery(q: any): string {
  try {
    if (!q || typeof q !== 'object') return 'invalid_query_object';
    const fieldsOk = Array.isArray(q.fields) && q.fields.length > 0;
    if (!fieldsOk) return 'query.fields required';
    const filters = Array.isArray(q.filters) ? q.filters : [];
    for (let i = 0; i < filters.length; i++) {
      const f = filters[i] || {};
      const t = String(f.filterType || '').toUpperCase();
      if (!t) return `filters[${i}].filterType missing`;
      const hasField = !!(f.field && typeof f.field === 'object' && typeof f.field.fieldCaption === 'string' && f.field.fieldCaption.length > 0);
      if (t !== 'TOP' && !hasField) return `filters[${i}].field required`;
      if (t === 'TOP') {
        if (typeof f.howMany !== 'number') return `filters[${i}].howMany required`;
        if (!f.fieldToMeasure || typeof f.fieldToMeasure !== 'object') return `filters[${i}].fieldToMeasure required`;
      } else if (t === 'SET') {
        if (!Array.isArray(f.values) || f.values.length === 0) return `filters[${i}].values required`;
      } else if (t === 'QUANTITATIVE_DATE') {
        const qft = String(f.quantitativeFilterType || '');
        if (!qft) return `filters[${i}].quantitativeFilterType required`;
        if (qft === 'RANGE' || qft === 'MIN') {
          if (!f.minDate || !isRfc3339Date(f.minDate)) return `filters[${i}].minDate must be RFC3339`;
        }
        if (qft === 'RANGE' || qft === 'MAX') {
          if (!f.maxDate || !isRfc3339Date(f.maxDate)) return `filters[${i}].maxDate must be RFC3339`;
        }
      } else if (t === 'QUANTITATIVE_NUMERICAL') {
        const qft = String(f.quantitativeFilterType || '');
        if (!qft) return `filters[${i}].quantitativeFilterType required`;
        if (qft === 'RANGE' || qft === 'MIN') {
          if (typeof f.minValue !== 'number') return `filters[${i}].minValue required`;
        }
        if (qft === 'RANGE' || qft === 'MAX') {
          if (typeof f.maxValue !== 'number') return `filters[${i}].maxValue required`;
        }
      } else if (t === 'DATE') {
        if (Array.isArray(f.values) && f.values.length) {
          for (const v of f.values) { if (!isRfc3339Date(v)) return `filters[${i}].values must be RFC3339 dates`; }
        }
        if (f.minDate && !isRfc3339Date(f.minDate)) return `filters[${i}].minDate must be RFC3339`;
        if (f.maxDate && !isRfc3339Date(f.maxDate)) return `filters[${i}].maxDate must be RFC3339`;
      }
    }
    return '';
  } catch {
    return '';
  }
}

