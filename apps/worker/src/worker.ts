import Fastify from 'fastify';
import PgBoss from 'pg-boss';
import type { JobDefinition } from './jobs/define.js';

export interface WorkerOptions {
  databaseUrl: string;
  jobs: JobDefinition[];
  logger?: boolean | { level: string };
}

/** pg-boss consumer plus a /health server. `start()` creates queues and begins working. */
export function buildWorker({ databaseUrl, jobs, logger = false }: WorkerOptions) {
  const boss = new PgBoss(databaseUrl);
  const app = Fastify({ logger });
  let ready = false;

  app.get('/health', async () => ({ status: 'ok', queue: ready }));
  boss.on('error', (err) => app.log.error({ err }, 'pg-boss error'));

  return {
    app,
    boss,
    async start() {
      await boss.start();
      for (const job of jobs) {
        await boss.createQueue(job.name);
        await boss.work(job.name, async (batch) => {
          for (const { data } of batch) await job.handler(job.payload.parse(data));
        });
      }
      ready = true;
      await app.ready();
    },
    async stop() {
      ready = false;
      await boss.stop();
      await app.close();
    },
  };
}
