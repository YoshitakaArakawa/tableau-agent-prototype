// Minimal event helpers for orchestrator phases (with file logging)

export type OrchestratorEvent = { type: string; detail?: any };

import { appendAnalysisLog } from "./logger";

export function safeEmit(cb: ((ev: OrchestratorEvent) => void) | undefined, ev: OrchestratorEvent) {
  try { cb && cb(ev); } catch {}
  try {
    const t = String(ev?.type || "");
    if (t && !t.endsWith(":delta") && t !== "final:delta") {
      const detail = ev?.detail ? JSON.stringify(ev.detail) : "";
      appendAnalysisLog(`[orchestrator] ${t}${detail ? " detail=" + detail : ""}`);
    }
  } catch {}
}
