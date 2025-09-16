import { safeEmit } from "../utils/events";
import { preflightValidateQuery } from "../utils/preflight";
import { tableauClient } from "../data/tableauClient";
import { saveVdsJson } from "../utils/artifacts";

export async function fetchRunner(params: {
  datasourceLuid: string;
  payloadObj: any;
  onEvent?: (ev: { type: string; detail?: any }) => void;
}): Promise<{ fetchedSummary?: string; artifactPath?: string; error?: string }>
{
  const { datasourceLuid, payloadObj, onEvent } = params;
  const q = payloadObj?.query;
  safeEmit(onEvent as any, { type: "fetch:start" });
  const started = Date.now();

  const preErr = preflightValidateQuery(q);
  if (preErr) {
    const error = `preflight:${preErr}`;
    safeEmit(onEvent as any, { type: "fetch:error", detail: { message: error } });
    return { error };
  }

  try {
    const res = await tableauClient.queryDatasource({ datasourceLuid, query: q });
    // Normalize summary
    const toText = (v: any): string => {
      try {
        if (typeof v === 'string') return v;
        if (Array.isArray(v)) return `rows=${v.length}`;
        if (v && typeof v === 'object') {
          const keys = ['rows','data','results'];
          for (const k of keys) {
            const arr = (v as any)[k];
            if (Array.isArray(arr)) return `${k}=${arr.length}`;
          }
          const s = JSON.stringify(v);
          return s.length > 800 ? s.slice(0, 800) : s;
        }
        return String(v);
      } catch { return '[unserializable fetch result]'; }
    };
    const summary = toText(res);
    let artifactPath = '';
    try {
      const normalized = (() => {
        try {
          if (Array.isArray(res) && res.length > 0 && res[0] && typeof res[0] === 'object' && typeof (res[0] as any).text === 'string') {
            const t = (res[0] as any).text as string;
            try { return JSON.parse(t); } catch { return res; }
          }
          if (typeof res === 'string') { try { return JSON.parse(res); } catch { return res; } }
        } catch {}
        return res;
      })();
      const art = saveVdsJson(normalized);
      artifactPath = art.relPath;
    } catch {}
    safeEmit(onEvent as any, { type: "fetch:done", detail: { summary, artifact: artifactPath || undefined, durationMs: Date.now() - started } });
    return { fetchedSummary: summary, artifactPath };
  } catch (e: any) {
    const error = e?.message || String(e);
    safeEmit(onEvent as any, { type: "fetch:error", detail: { message: error, durationMs: Date.now() - started } });
    return { error };
  }
}
