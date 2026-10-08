import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createApiClient } from '@paras/shared';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { createMcpServer } from './server.js';

export interface McpAppOptions {
  apiUrl?: string;
  /** Injected in tests to dispatch in-process. */
  fetch?: typeof fetch;
}

/** CDN geo headers; forwarded so the API computes per-Venue availability for the caller. */
const GEO_HEADERS = ['cf-ipcountry', 'x-vercel-ip-country'] as const;

export function buildApp({
  apiUrl = 'http://localhost:3000',
  fetch,
  ...opts
}: FastifyServerOptions & McpAppOptions = {}) {
  const app = Fastify(opts);

  app.get('/health', async () => ({ status: 'ok' }));

  // Stateless Streamable HTTP: a fresh server + transport per request.
  app.post('/mcp', async (req, reply) => {
    const headers: Record<string, string> = {};
    for (const h of GEO_HEADERS) {
      const v = req.headers[h];
      if (typeof v === 'string') headers[h] = v;
    }
    const api = createApiClient({ baseUrl: apiUrl, headers, ...(fetch && { fetch }) });
    const server = createMcpServer(api);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  const notAllowed = async (
    _req: unknown,
    reply: { status(n: number): { send(b: unknown): unknown } },
  ) =>
    reply
      .status(405)
      .send({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);

  return app;
}
