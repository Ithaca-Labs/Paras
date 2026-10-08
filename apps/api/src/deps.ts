import type { AdapterRegistry } from '@paras/adapters';
import type { Database } from '@paras/db';
import type { AuthDeps } from './auth/types.js';

/** Everything routes may touch. Tests build this with a fresh DB and fake adapters. */
export interface AppDeps {
  db: Database;
  adapters: AdapterRegistry;
  auth: AuthDeps;
  /** Wall clock, injectable for freshness tests. */
  now?: () => Date;
  /** How often SSE streams re-read latest Quotes from Postgres. Default 2000 ms. */
  ssePollMs?: number;
}

/** A Quote older than this is flagged `stale` in API responses. */
export const QUOTE_STALE_AFTER_MS = 2 * 60_000;
