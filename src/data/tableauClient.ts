import { getTableauMcp } from "../mcp/tableau";

export type QueryDatasourceParams = {
  datasourceLuid: string;
  query: any;
  timeoutMs?: number;
};

export const tableauClient = {
  async queryDatasource(params: QueryDatasourceParams): Promise<any> {
    const { datasourceLuid, query, timeoutMs = Number(process.env.TABLEAU_CLIENT_TIMEOUT_MS || 15000) } = params;
    const tableauMcp = getTableauMcp();
    if (!tableauMcp) throw new Error("tableau_mcp_not_configured");
    const call = (tableauMcp as any).callTool('query-datasource', { datasourceLuid, query } as any);
    const timed = Promise.race([
      call,
      new Promise((_r, rej) => setTimeout(() => rej(new Error('tableau_client_timeout')), timeoutMs)),
    ]);
    return await timed;
  }
} as const;
