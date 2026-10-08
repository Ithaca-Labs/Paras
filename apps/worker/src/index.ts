import {
  createAdapterRegistry,
  createKalshiAdapter,
  createLimitlessAdapter,
  createPolymarketAdapter,
  createSxBetAdapter,
  longTailAdaptersFromEnv,
} from '@paras/adapters';
import { createDb } from '@paras/db';
import { createTransformersEmbedder } from '@paras/embeddings';
import { createMailer } from '@paras/shared';
import { loadConfig } from './config.js';
import { buildJobs, buildSchedules } from './jobs/index.js';
import { buildWorker } from './worker.js';

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL);
const adapters = createAdapterRegistry([
  createPolymarketAdapter(),
  createLimitlessAdapter(),
  createSxBetAdapter(),
  createKalshiAdapter(),
  // Long-tail Venues; key-gated ones are off while their key is unset.
  ...longTailAdaptersFromEnv(process.env),
]);
const venues = [...adapters.keys()];

const worker = buildWorker({
  databaseUrl: config.DATABASE_URL,
  jobs: buildJobs({
    db,
    adapters,
    mailer: createMailer(config, (line) => worker.app.log.info(line)),
    ...(config.EMBEDDING_MODEL !== 'off' && {
      embedder: createTransformersEmbedder({
        model: config.EMBEDDING_MODEL,
        cacheDir: config.EMBEDDING_CACHE_DIR,
      }),
    }),
    log: (msg, data) => worker.app.log.info(data, msg),
  }),
  schedules: buildSchedules(venues),
  startup: venues.map((venue) => ({ queue: 'venue.sync-markets', data: { venue } })),
  logger: { level: config.LOG_LEVEL },
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void worker.stop().then(close));
}

await worker.start();
await worker.app.listen({ port: config.WORKER_PORT, host: '0.0.0.0' });
