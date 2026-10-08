import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('executor', () => {
  it('serves /health', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});
