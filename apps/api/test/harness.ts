import { createAdapterRegistry, type VenueAdapter } from '@paras/adapters';
import { createDb } from '@paras/db';
import type { Embedder, FeedWeights } from '@paras/domain';
import { createApiClient } from '@paras/shared';
import { createTestDatabase } from '@paras/testkit';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { OAuthDeps } from '../src/deps.js';
import { MemoryMailer } from '../src/auth/mailer.js';
import type { MagicLinkDeps } from '../src/deps.js';
import type { VaultReader } from '../src/vault.js';
import { defaultAuthConfig, type AuthConfig } from '../src/auth/types.js';

export interface TestAppOptions {
  /** Fake Venue adapters (fixture-backed) injected instead of the real ones. */
  adapters?: VenueAdapter[];
  /** Override auth settings (TTLs, rate limits, ...). */
  auth?: Partial<AuthConfig>;
  /** Override Magic Link settings (keys, TTLs, ...). */
  magicLinks?: Partial<MagicLinkDeps>;
  /** Fake embedder (`createFakeEmbedder`) enabling semantic search; omit for full-text only. */
  embedder?: Embedder;
  /** Fake Vault chain reader; omit for the 503 path. */
  vault?: VaultReader;
  /** Injected clock for freshness (`stale`) assertions. */
  now?: () => Date;
  /** Feed weight overrides. */
  feedWeights?: Partial<FeedWeights>;
  /** SSE re-read interval; tests use a small value. */
  ssePollMs?: number;
  oauth?: Partial<OAuthDeps>;
}

export const TEST_AUTH_DOMAIN = 'paras.test';
export const TEST_WEB_BASE_URL = 'https://web.paras.test';

/** `fetch` that dispatches in-process via fastify.inject: no sockets, no network. */
export function injectFetch(app: FastifyInstance): typeof fetch {
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
    ...(options.embedder && { embedder: options.embedder }),
    ...(options.now && { now: options.now }),
    ...(options.vault && { vault: options.vault }),
    ...(options.feedWeights && { feedWeights: options.feedWeights }),
    ssePollMs: options.ssePollMs ?? 50,
    ...(options.oauth && { oauth: { issuer: 'http://localhost:3000', ...options.oauth } }),
    magicLinks: {
      keys: { activeKid: 'k1', keys: { k1: 'test-magic-key-test-magic-key-0001' } },
      webBaseUrl: TEST_WEB_BASE_URL,
      defaultTtlMs: 3600_000,
      maxTtlMs: 86_400_000,
      now: () => new Date(Date.now() + clock.offsetMs),
      ...options.magicLinks,
    },
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
