import { loadConfig } from './config.js';
import { jobs } from './jobs/index.js';
import { buildWorker } from './worker.js';

const config = loadConfig();
const worker = buildWorker({
  databaseUrl: config.DATABASE_URL,
  jobs,
  logger: { level: config.LOG_LEVEL },
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void worker.stop());

await worker.start();
await worker.app.listen({ port: config.WORKER_PORT, host: '0.0.0.0' });
