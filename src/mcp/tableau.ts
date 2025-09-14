// Minimal Tableau MCP connector using @openai/agents MCPServerStdio.
// Only reads TABLEAU_MCP_FILEPATH and starts it with the current Node executable.

import { MCPServerStdio } from "@openai/agents";

export function createTableauMcpFromEnv(env: NodeJS.ProcessEnv) {
  const filePath = env.TABLEAU_MCP_FILEPATH;
  if (!filePath) return null;
  return new MCPServerStdio({
    name: "tableau-mcp",
    command: process.execPath || "node",
    args: [filePath],
  } as any);
}

let singleton: MCPServerStdio | null = null;
export function getTableauMcp(): MCPServerStdio | null {
  if (singleton) return singleton;
  singleton = createTableauMcpFromEnv(process.env);
  return singleton;
}

export async function connectTableauMcp(): Promise<boolean> {
  const srv = getTableauMcp();
  if (!srv) return false;
  try { await srv.connect(); return true; } catch { return false; }
}

export async function closeTableauMcp() {
  try { await getTableauMcp()?.close(); } catch {}
}
