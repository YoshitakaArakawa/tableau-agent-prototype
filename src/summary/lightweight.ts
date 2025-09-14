import fs from "fs";
import path from "path";

export type AnalysisContext = {
  intent?: string;
  goal?: string;
  hypothesis?: string;
  metrics?: string[];
  successCriteria?: string | string[];
  vizSpec?: any;
};

function tryReadJson(p: string): any {
  try {
    const full = path.resolve(process.cwd(), p);
    const raw = fs.readFileSync(full, 'utf8');
    return JSON.parse(raw);
  } catch { return null; }
}

function extractSingleNumber(json: any): number | null {
  try {
    if (typeof json === 'number') return json;
    if (Array.isArray(json?.rows) && json.rows.length === 1) {
      const r = json.rows[0];
      if (Array.isArray(r)) {
        for (const cell of r) { const n = Number(cell); if (Number.isFinite(n)) return n; }
      } else if (r && typeof r === 'object') {
        for (const v of Object.values(r)) { const n = Number(v as any); if (Number.isFinite(n)) return n; }
      }
    }
    if (Array.isArray(json?.data) && json.data.length === 1) {
      const r = json.data[0];
      if (r && typeof r === 'object') { for (const v of Object.values(r)) { const n = Number(v as any); if (Number.isFinite(n)) return n; } }
    }
  } catch {}
  return null;
}

export function summarizeLightweight(message: string, artifactPaths: string[], ctx?: AnalysisContext): string {
  const nums: number[] = [];
  for (const p of artifactPaths.slice(0, 2)) {
    const json = tryReadJson(p);
    const n = extractSingleNumber(json);
    if (n !== null && Number.isFinite(n)) nums.push(n);
  }
  if (nums.length === 1) {
    const v = nums[0];
    return `${Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(v)}`;
  }
  if (nums.length >= 2) {
    const a = nums[0], b = nums[1];
    const delta = b - a;
    const pct = a !== 0 ? (delta / a) * 100 : 0;
    const fmt = (x: number) => Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(x);
    return `${fmt(b)} vs ${fmt(a)} (Δ ${fmt(delta)}; ${pct.toFixed(2)}%)`;
  }
  return 'Unable to produce a lightweight summary from artifacts.';
}

export function countRowsForHeuristic(p: string): number {
  const json = tryReadJson(p);
  try {
    if (Array.isArray(json?.rows)) return json.rows.length;
    if (Array.isArray(json?.data)) return json.data.length;
    if (Array.isArray(json)) return json.length;
  } catch {}
  return 0;
}

