import { safeEmit } from "../utils/events";
import type { OrchestratorEvent } from "../types/orchestrator";
import { getMetadataCached, getLastMetadataError, type NormalizedField } from "../utils/metadataCache";

export async function metadataPhase(params: {
  datasourceLuid: string;
  needsMetadata: boolean;
  onEvent?: (ev: OrchestratorEvent) => void;
}): Promise<{ normalizedFields?: NormalizedField[]; reply?: string }>
{
  const { datasourceLuid, needsMetadata, onEvent } = params;
  const normalizedFields: NormalizedField[] = [];
  if (!needsMetadata) return { normalizedFields };

  safeEmit(onEvent, { type: "metadata:start" });
  const started = Date.now();
  try {
    const cached = await getMetadataCached(datasourceLuid);
    const arr = cached?.normalized || [];
    if (!Array.isArray(arr) || arr.length === 0) {
      const errMsg = getLastMetadataError() || 'no fields';
      safeEmit(onEvent, { type: "metadata:error", detail: { message: errMsg, datasourceLuid } });
      return { reply: `No metadata fields available for the datasource. ${errMsg}. Please verify credentials and the datasource LUID (${datasourceLuid}).` };
    }
    safeEmit(onEvent, { type: "metadata:done", detail: { count: arr.length, durationMs: Date.now() - started } });
    return { normalizedFields: arr };
  } catch (e: any) {
    safeEmit(onEvent, { type: "metadata:error", detail: { message: e?.message || String(e), datasourceLuid, durationMs: Date.now() - started } });
    return { reply: `Failed to retrieve metadata for datasource LUID (${datasourceLuid}).` };
  }
}
