// Metadata cache and normalizer for Tableau datasource fields via MCP.
// - In-memory cache with optional TTL (METADATA_CACHE_TTL_MS)
// - Disk cache at logs/metadata_json/<site>/LUID.json
// - Normalizes fields to { fieldCaption, dataType?, defaultAggregation? }

import fs from "fs";
import path from "path";
import { getTableauMcp } from "../mcp/tableau";
import { appendAnalysisLog } from "./logger";
import { extractResultJson } from "./mcp";

export type NormalizedField = {
  fieldCaption: string;
  dataType?: string;
  defaultAggregation?: string | null;
};

type CachedEntry = {
  raw: any;
  normalized: NormalizedField[];
  ts: number;
};

const cache = new Map<string, CachedEntry>();

function ttlMs() {
  const v = process.env.METADATA_CACHE_TTL_MS ? Number(process.env.METADATA_CACHE_TTL_MS) : NaN;
  return Number.isFinite(v) && v > 0 ? v : 0; // 0 => no expiry
}

function now() { return Date.now(); }

function isExpired(entry: CachedEntry): boolean {
  const ttl = ttlMs();
  if (!ttl) return false;
  return now() - entry.ts > ttl;
}

function siteSegment(): string {
  const s = String(process.env.SITE_NAME || "default");
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function metadataDir(): string {
  const dir = path.resolve(process.cwd(), "logs", "metadata_json", siteSegment());
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

function metadataFilePath(datasourceLuid: string): string {
  return path.join(metadataDir(), `${datasourceLuid}.json`);
}

function readDiskCache(datasourceLuid: string): { normalized: NormalizedField[]; mtimeMs: number } | null {
  const file = metadataFilePath(datasourceLuid);
  try {
    if (!fs.existsSync(file)) return null;
    const stat = fs.statSync(file);
    const ttl = ttlMs();
    if (ttl > 0 && Date.now() - stat.mtimeMs > ttl) return null;
    const raw = fs.readFileSync(file, { encoding: 'utf8' });
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return { normalized: arr as NormalizedField[], mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

function writeDiskCache(datasourceLuid: string, fields: NormalizedField[]): void {
  const file = metadataFilePath(datasourceLuid);
  try { fs.writeFileSync(file, JSON.stringify(fields ?? [], null, 2), { encoding: 'utf8' }); } catch {}
}

function normalizeFromReadMetadata(raw: any): NormalizedField[] {
  // Prefer { data: [...] }; fallback to array or { fields: [...] }
  const items = Array.isArray(raw?.data)
    ? raw.data
    : Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.fields)
        ? raw.fields
        : [];
  const out: NormalizedField[] = [];
  for (const it of items) {
    const fieldCaption = String(it?.fieldCaption || it?.fieldName || it?.name || '').trim();
    if (!fieldCaption) continue;
    const dataType = typeof it?.dataType === 'string' ? it.dataType : undefined;
    let defaultAggregation: string | null = null;
    if (typeof it?.defaultAggregation === 'string') {
      const agg = String(it.defaultAggregation).toUpperCase();
      const nonExec = new Set([
        'YEAR','QUARTER','MONTH','WEEK','DAY',
        'TRUNC_YEAR','TRUNC_QUARTER','TRUNC_MONTH','TRUNC_WEEK','TRUNC_DAY',
        'AGG','NONE','UNSPECIFIED'
      ]);
      if (agg === 'COUNTD') defaultAggregation = 'COUNT_DISTINCT';
      else if (!nonExec.has(agg)) defaultAggregation = agg;
    }
    out.push({ fieldCaption, dataType, defaultAggregation });
  }
  return out;
}

function normalizeFields(raw: any): NormalizedField[] {
  if (Array.isArray(raw?.data)) return normalizeFromReadMetadata(raw);
  if (Array.isArray(raw?.fields)) return normalizeFromReadMetadata({ data: raw.fields });
  if (Array.isArray(raw)) return normalizeFromReadMetadata({ data: raw });
  return [];
}

async function fetchViaMcp(datasourceLuid: string): Promise<CachedEntry | null> {
  const tableauMcp = getTableauMcp();
  if (!tableauMcp) { try { appendAnalysisLog(`[metadata] mcp_unavailable`); } catch {}; return null; }
  const tool = 'get-datasource-metadata';
  const args = { datasourceLuid } as any;
  try {
    try { appendAnalysisLog(`[metadata] call tool=${tool} ds=${datasourceLuid}`); } catch {}
    const res: any = await (tableauMcp as any).callTool(tool, args);
    const json = extractResultJson(res);
    const normalized: NormalizedField[] = normalizeFields(json ?? res);
    try { appendAnalysisLog(`[metadata] result count=${normalized.length}`); } catch {}
    const entry: CachedEntry = { raw: json ?? res, normalized, ts: now() };
    return entry;
  } catch (e: any) {
    try { appendAnalysisLog(`[metadata] fetch_error ds=${datasourceLuid} message=${e?.message || String(e)}`); } catch {}
    lastErrorMsg = e?.message || String(e);
    return null;
  }
}

export async function getMetadataCached(datasourceLuid: string, force?: boolean) {
  const key = datasourceLuid;
  const hit = cache.get(key);
  if (!force && hit && !isExpired(hit) && Array.isArray(hit.normalized) && hit.normalized.length > 0) {
    try { appendAnalysisLog(`[metadata] cache_hit count=${hit.normalized.length}`); } catch {}
    return hit;
  }
  if (!force) {
    const disk = readDiskCache(datasourceLuid);
    if (disk) {
      const entry: CachedEntry = { raw: null, normalized: disk.normalized, ts: disk.mtimeMs };
      cache.set(key, entry);
      try { appendAnalysisLog(`[metadata] disk_hit count=${entry.normalized.length}`); } catch {}
      return entry;
    }
  }
  const fresh = await fetchViaMcp(datasourceLuid);
  if (fresh) {
    if (Array.isArray(fresh.normalized) && fresh.normalized.length > 0) {
      cache.set(key, fresh);
      try { writeDiskCache(datasourceLuid, fresh.normalized); appendAnalysisLog(`[metadata] disk_saved count=${fresh.normalized.length}`); } catch {}
      try { appendAnalysisLog(`[metadata] cache_set count=${fresh.normalized.length}`); } catch {}
    }
    return fresh;
  }
  try { appendAnalysisLog(`[metadata] empty_or_error ds=${datasourceLuid}`); } catch {}
  return hit || null;
}

let lastErrorMsg: string | null = null;
export function getLastMetadataError(): string | null {
  return lastErrorMsg;
}


