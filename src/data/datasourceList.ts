import { appendAnalysisLog } from "../utils/logger";
import { extractResultJson } from "../utils/mcp";
import { getTableauMcp } from "../mcp/tableau";

export type DatasourceSummary = {
  id: string;
  name: string;
  projectName?: string | null;
};

function normalizeNames(names?: string[]): string[] {
  if (!Array.isArray(names)) return [];
  return names
    .map((name) => String(name ?? "").trim())
    .filter((name) => name.length > 0)
    .map((name) => name.toLowerCase());
}

export async function listDatasourcesViaMcp(): Promise<DatasourceSummary[]> {
  const mcp = getTableauMcp();
  if (!mcp) throw new Error("tableau_mcp_not_configured");
  try { appendAnalysisLog("datasource:list request"); } catch {}
  const result: any = await (mcp as any).callTool("list-datasources", {} as any);
  const payload = extractResultJson(result) ?? result;
  const rows: any[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.value)
      ? payload.value
      : [];
  const items: DatasourceSummary[] = [];
  for (const row of rows) {
    const id = String(row?.id || "").trim();
    const name = String(row?.name || "").trim();
    if (!id || !name) continue;
    items.push({ id, name, projectName: row?.project?.name ?? row?.projectName ?? null });
  }
  try { appendAnalysisLog(`datasource:list size=${items.length}`); } catch {}
  return items;
}

export async function resolveDatasourcesByNames(names?: string[]): Promise<DatasourceSummary[]> {
  const normalized = normalizeNames(names);
  const all = await listDatasourcesViaMcp();
  if (!normalized.length) return all;
  const set = new Set(normalized);
  return all.filter((item) => set.has(item.name.trim().toLowerCase()));
}
