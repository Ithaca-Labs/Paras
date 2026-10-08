import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ApiError, createApiClient } from '@paras/shared';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { createMcpServer } from './server.js';

export interface McpAppOptions {
  apiUrl?: string;
  /** Public origin of this server (resource metadata). */
  publicUrl?: string;
  /** Public origin of the OAuth authorization server (apps/api). */
  issuer?: string;
  /** Injected in tests to dispatch in-process. */
  fetch?: typeof fetch;
}

/** CDN geo headers; forwarded so the API computes per-Venue availability for the caller. */
const GEO_HEADERS = ['cf-ipcountry', 'x-vercel-ip-country'] as const;

/** Tools that need an OAuth token, and the scope each requires. */
const PERSONAL_SCOPES: Record<string, string> = {
  get_my_feed: 'feed:read',
  get_portfolio: 'portfolio:read',
};
const SCOPES = ['markets:read', 'feed:read', 'portfolio:read'];

export function buildApp({
  apiUrl = 'http://localhost:3000',
  publicUrl = 'http://localhost:3002',
  issuer = apiUrl,
  fetch,
  ...opts
}: FastifyServerOptions & McpAppOptions = {}) {
  const app = Fastify(opts);

  app.get('/health', async () => ({ status: 'ok' }));

  // OAuth 2.1 resource server (MCP authorization spec): tokens are issued by apps/api.
  const metadataUrl = `${publicUrl.replace(/\/$/, '')}/.well-known/oauth-protected-resource`;
  const metadata = async () => ({
    resource: `${publicUrl.replace(/\/$/, '')}/mcp`,
    authorization_servers: [issuer.replace(/\/$/, '')],
    scopes_supported: SCOPES,
    bearer_methods_supported: ['header'],
  });
  app.get('/.well-known/oauth-protected-resource', metadata);
  app.get('/.well-known/oauth-protected-resource/mcp', metadata);

  const challenge = (error?: string, scope?: string) =>
    `Bearer resource_metadata="${metadataUrl}"` +
    (error ? `, error="${error}"` : '') +
    (scope ? `, scope="${scope}"` : '');

  // Stateless Streamable HTTP: a fresh server + transport per request.
  app.post('/mcp', async (req, reply) => {
    const headers: Record<string, string> = {};
    for (const h of GEO_HEADERS) {
      const v = req.headers[h];
      if (typeof v === 'string') headers[h] = v;
    }
    const api = createApiClient({ baseUrl: apiUrl, headers, ...(fetch && { fetch }) });

    // Public tools need no token. A presented token must be live (revocation is checked on the
    // API every call); personal tools additionally need a token with their scope.
    const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
    const calls = [req.body].flat() as { method?: string; params?: { name?: string } }[];
    const needed = calls
      .filter((c) => c?.method === 'tools/call')
      .map((c) => PERSONAL_SCOPES[c.params?.name ?? ''])
      .filter((x): x is string => !!x);
    const deny = (status: 401 | 403, error: string | undefined, scope?: string) =>
      reply
        .status(status)
        .header('www-authenticate', challenge(error, scope))
        .send({ error: error ?? 'unauthorized' });
    let me = api;
    if (bearer) {
      me = createApiClient({
        baseUrl: apiUrl,
        headers: { ...headers, authorization: `Bearer ${bearer}` },
        ...(fetch && { fetch }),
      });
      try {
        const info = await me.getTokenInfo();
        const missing = needed.find((s) => !info.scopes.includes(s as never));
        if (missing) return deny(403, 'insufficient_scope', missing);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return deny(401, 'invalid_token');
        throw e;
      }
    } else if (needed.length) {
      return deny(401, undefined, needed[0]);
    }

    const server = createMcpServer(api, me);
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
