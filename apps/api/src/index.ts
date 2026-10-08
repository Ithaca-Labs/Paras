import { createAdapterRegistry, createPolymarketAdapter } from '@paras/adapters';
import { createDb } from '@paras/db';
import { buildApp } from './app.js';
import { createMailer } from './auth/mailer.js';
import { defaultAuthConfig } from './auth/types.js';
import { loadConfig, loadMagicLinkKeys } from './config.js';

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL);
const app = buildApp(
  {
    db,
    adapters: createAdapterRegistry([createPolymarketAdapter()]),
    magicLinks: {
      keys: loadMagicLinkKeys(config),
      webBaseUrl: config.WEB_BASE_URL,
      defaultTtlMs: config.MAGIC_LINK_TTL_SECONDS * 1000,
      maxTtlMs: config.MAGIC_LINK_MAX_TTL_SECONDS * 1000,
      now: () => new Date(),
    },
    auth: {
      config: defaultAuthConfig({
        secret: config.AUTH_SECRET ?? 'dev-only-insecure-auth-secret-change-me',
        domain: config.AUTH_DOMAIN,
        chainIds: config.AUTH_CHAIN_IDS.split(',').map(Number),
        secureCookie:
          (config.AUTH_COOKIE_SECURE ?? String(process.env.NODE_ENV === 'production')) === 'true',
      }),
      mailer: createMailer(config),
      now: () => new Date(),
    },
  },
  { logger: { level: config.LOG_LEVEL } },
);

app.addHook('onClose', close);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void app.close());

await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
