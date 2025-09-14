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

export const tableauMcp = createTableauMcpFromEnv(process.env);

export async function connectTableauMcp() {
  if (!tableauMcp) return;
  await tableauMcp.connect();
}

export async function closeTableauMcp() {
  try { await tableauMcp?.close(); } catch {}
}
