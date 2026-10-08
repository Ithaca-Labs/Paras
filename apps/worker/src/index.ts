import {
  createAdapterRegistry,
  createLimitlessAdapter,
  createPolymarketAdapter,
  createSxBetAdapter,
} from '@paras/adapters';
import { createDb } from '@paras/db';
import { loadConfig } from './config.js';
import { buildJobs, buildSchedules } from './jobs/index.js';
import { buildWorker } from './worker.js';

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL);
const adapters = createAdapterRegistry([
  createPolymarketAdapter(),
  createLimitlessAdapter(),
  createSxBetAdapter(),
]);
const venues = [...adapters.keys()];

const worker = buildWorker({
  databaseUrl: config.DATABASE_URL,
  jobs: buildJobs({
    db,
    adapters,
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
