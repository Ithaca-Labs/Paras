import type { AdapterRegistry } from '@paras/adapters';
import type { Database } from '@paras/db';
import type { Embedder, MagicLinkKeys } from '@paras/domain';
import type { AuthDeps } from './auth/types.js';
import type { GeoResolver } from './jurisdiction.js';

export interface MagicLinkDeps {
  /** Signing keys by kid (rotation: add a key, switch `activeKid`, drop old keys after their TTL). */
  keys: MagicLinkKeys;
  /** Public web app origin used to build shareable URLs (WEB_BASE_URL). */
  webBaseUrl: string;
  defaultTtlMs: number;
  maxTtlMs: number;
  now: () => Date;
}

/** Everything routes may touch. Tests build this with a fresh DB and fake adapters. */
export interface AppDeps {
  db: Database;
  adapters: AdapterRegistry;
  auth: AuthDeps;
  magicLinks: MagicLinkDeps;
  /** Embeds search queries for semantic search. Omit for full-text only. */
  embedder?: Embedder;
  /** Country resolver; default trusts the CDN country header. */
  geo?: GeoResolver;
  /** Wall clock, injectable for freshness tests. */
  now?: () => Date;
  /** How often SSE streams re-read latest Quotes from Postgres. Default 2000 ms. */
  ssePollMs?: number;
}

/** A Quote older than this is flagged `stale` in API responses. */
export const QUOTE_STALE_AFTER_MS = 2 * 60_000;
