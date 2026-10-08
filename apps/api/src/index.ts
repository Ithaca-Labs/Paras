import { createAdapterRegistry } from '@paras/adapters';
import { createDb } from '@paras/db';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL);
const app = buildApp(
  { db, adapters: createAdapterRegistry() },
  { logger: { level: config.LOG_LEVEL } },
);

app.addHook('onClose', close);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void app.close());

await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
