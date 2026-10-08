import { z } from '@paras/shared';
import { createTestDatabase, type TestDatabase } from '@paras/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineJob } from '../src/jobs/define.js';
import { buildWorker } from '../src/worker.js';

let db: TestDatabase;
let worker: ReturnType<typeof buildWorker>;
const received: string[] = [];
const echo = defineJob({
  name: 'test.echo',
  payload: z.object({ message: z.string() }),
  handler: async ({ message }) => void received.push(message),
});

beforeAll(async () => {
  db = await createTestDatabase();
  worker = buildWorker({ databaseUrl: db.url, jobs: [echo] });
  await worker.start();
});
afterAll(async () => {
  await worker.stop();
  await db.drop();
});

describe('worker', () => {
  it('serves /health', async () => {
    const res = await worker.app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({ status: 'ok', queue: true });
  });

  it('runs a job sent through pg-boss', async () => {
    await worker.boss.send('test.echo', { message: 'hello' });
    await expect.poll(() => received, { timeout: 15_000 }).toEqual(['hello']);
  });
});
