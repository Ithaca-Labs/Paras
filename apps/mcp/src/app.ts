import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { createMcpServer } from './server.js';

export function buildApp(opts: FastifyServerOptions = {}) {
  const app = Fastify(opts);

  app.get('/health', async () => ({ status: 'ok' }));

  // Stateless Streamable HTTP: a fresh server + transport per request.
  app.post('/mcp', async (req, reply) => {
    const server = createMcpServer();
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
