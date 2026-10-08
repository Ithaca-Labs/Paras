import { createAdapterRegistry, type VenueAdapter } from '@paras/adapters';
import { createDb } from '@paras/db';
import { createApiClient } from '@paras/shared';
import { createTestDatabase } from '@paras/testkit';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryMailer } from '../src/auth/mailer.js';
import { defaultAuthConfig, type AuthConfig } from '../src/auth/types.js';

export interface TestAppOptions {
  /** Fake Venue adapters (fixture-backed) injected instead of the real ones. */
  adapters?: VenueAdapter[];
  /** Override auth settings (TTLs, rate limits, ...). */
  auth?: Partial<AuthConfig>;
  /** Injected clock for freshness (`stale`) assertions. */
  now?: () => Date;
  /** SSE re-read interval; tests use a small value. */
  ssePollMs?: number;
}

export const TEST_AUTH_DOMAIN = 'paras.test';

/** `fetch` that dispatches in-process via fastify.inject: no sockets, no network. */
function injectFetch(app: FastifyInstance): typeof fetch {
  return async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const res = await app.inject({
      method: req.method as 'GET',
      url: url.pathname + url.search,
      headers: Object.fromEntries(req.headers),
      payload: req.body ? await req.text() : undefined,
    });
    const headers = new Headers();
    for (const [k, v] of Object.entries(res.headers)) {
      for (const item of [v ?? []].flat()) headers.append(k, String(item));
    }
    return new Response(res.body, { status: res.statusCode, headers });
  };
}

/**
 * Boots apps/api against its own freshly migrated Postgres database (pgvector enabled).
 * Requires the @paras/testkit globalSetup in vitest.config.ts. Use in beforeAll, `close` in afterAll.
 */
export async function createTestApp(options: TestAppOptions = {}) {
  const testDb = await createTestDatabase();
  const { db, close: closeDb } = createDb(testDb.url);
  const mailer = new MemoryMailer();
  const clock = { offsetMs: 0, advance: (ms: number) => void (clock.offsetMs += ms) };
  const app = buildApp({
    db,
    adapters: createAdapterRegistry(options.adapters),
    ...(options.now && { now: options.now }),
    ssePollMs: options.ssePollMs ?? 50,
    auth: {
      config: defaultAuthConfig({
        secret: 'test-secret-test-secret-test-secret-00',
        domain: TEST_AUTH_DOMAIN,
        ...options.auth,
      }),
      mailer,
      now: () => new Date(Date.now() + clock.offsetMs),
    },
  });
  await app.ready();
  return {
    app,
    db,
    /** Captures outbound email (sign-in codes). */
    mailer,
    /** `clock.advance(ms)` moves the time the app sees (expiry tests). */
    clock,
    /** Typed client from @paras/shared, wired to this app. */
    client: createApiClient({ baseUrl: 'http://api.test', fetch: injectFetch(app) }),
    async close() {
      await app.close();
      await closeDb();
      await testDb.drop();
    },
  };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;
