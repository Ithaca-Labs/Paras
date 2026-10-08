import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Read-only MCP server. Register tools here, each a thin wrapper over the typed API client
 * (createApiClient from @paras/shared). Never add a tool that moves money or places trades.
 */
export function createMcpServer(): McpServer {
  return new McpServer({ name: 'paras', version: '0.0.0' });
}
