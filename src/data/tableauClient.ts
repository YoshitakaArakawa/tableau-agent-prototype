import { getTableauMcp } from "../mcp/tableau";

export type QueryDatasourceParams = {
  datasourceLuid: string;
  query: any;
  timeoutMs?: number;
  signal?: AbortSignal;
};

function createAbortError(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

export const tableauClient = {
  async queryDatasource(params: QueryDatasourceParams): Promise<any> {
    const { datasourceLuid, query, timeoutMs = Number(process.env.TABLEAU_CLIENT_TIMEOUT_MS || 15000), signal } = params;
    const tableauMcp = getTableauMcp();
    if (!tableauMcp) throw new Error("tableau_mcp_not_configured");
    const call = (tableauMcp as any).callTool('query-datasource', { datasourceLuid, query } as any) as Promise<any>;

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise((_resolve, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('tableau_client_timeout')), timeoutMs);
    });

    let abortHandler: (() => void) | undefined;
    const abortPromise = signal
      ? new Promise((_resolve, reject) => {
          if (signal.aborted) {
            reject(createAbortError());
            return;
          }
          abortHandler = () => reject(createAbortError());
          signal.addEventListener('abort', abortHandler);
        })
      : null;

    try {
      const races: Array<Promise<any>> = [call, timeoutPromise];
      if (abortPromise) races.push(abortPromise);
      return await Promise.race(races);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
    }
  }
} as const;
