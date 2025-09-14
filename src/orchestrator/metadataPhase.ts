import { safeEmit } from "../utils/events";
import type { OrchestratorEvent } from "../types/orchestrator";
import { getMetadataCached, type NormalizedField } from "../utils/metadataCache";

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
  try {
    const cached = await getMetadataCached(datasourceLuid);
    const arr = cached?.normalized || [];
    if (!Array.isArray(arr) || arr.length === 0) {
      safeEmit(onEvent, { type: "metadata:error", detail: { message: "no fields" } });
      return { reply: "No metadata fields available." };
    }
    safeEmit(onEvent, { type: "metadata:done", detail: { count: arr.length } });
    return { normalizedFields: arr };
  } catch (e: any) {
    safeEmit(onEvent, { type: "metadata:error", detail: { message: e?.message || String(e) } });
    return { reply: "Failed to retrieve metadata." };
  }
}

