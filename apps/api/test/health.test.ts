import { createFakeAdapter } from '@paras/adapters';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ adapters: [createFakeAdapter({ id: 'fake-venue' })] });
});
afterAll(() => t.close());

describe('GET /v1/health', () => {
  it('reports ok, db up and the injected fake adapters', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: true, venues: ['fake-venue'] });
  });

  it('is callable through the typed client', async () => {
    await expect(t.client.getHealth()).resolves.toMatchObject({ status: 'ok' });
  });
});

describe('GET /v1/openapi.json', () => {
  it('serves an OpenAPI 3.1 document generated from the zod routes', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/openapi.json' });
    const doc = res.json();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths['/v1/health'].get.operationId).toBe('getHealth');
  });
});

describe('database', () => {
  it('has pgvector enabled and round-trips a vector', async () => {
    const ext = await t.db.execute(sql`select extname from pg_extension where extname = 'vector'`);
    expect(ext.rows).toHaveLength(1);
    const res = await t.db.execute(sql`select '[1,2,3]'::vector <-> '[1,2,4]'::vector as dist`);
    expect(Number(res.rows[0]?.dist)).toBe(1);
  });
});

describe('errors', () => {
  it('returns the shared error shape for unknown routes', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });
});
