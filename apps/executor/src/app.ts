import Fastify, { type FastifyServerOptions } from 'fastify';

/** The only service that may hold signing keys. No keys or Intent handling yet (see Vault issues). */
export function buildApp(opts: FastifyServerOptions = {}) {
  const app = Fastify(opts);
  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}
