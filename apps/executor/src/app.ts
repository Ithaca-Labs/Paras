import Fastify, { type FastifyServerOptions } from 'fastify';

/** The only service that may hold signing keys. No keys or Intent handling yet (see Vault issues). */
export function buildApp(opts: FastifyServerOptions = {}, extra: { demo?: boolean } = {}) {
  const app = Fastify(opts);
  app.get('/health', async () => ({
    status: 'ok',
    ...(extra.demo && { demo: 'simulated Polymarket leg, testnet only' }),
  }));
  return app;
}
