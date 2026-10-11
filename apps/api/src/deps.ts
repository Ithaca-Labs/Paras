import type { AdapterRegistry } from '@paras/adapters';
import type { Database } from '@paras/db';
import type { PrivyPort } from '@paras/privy';
import type { Embedder, FeedWeights, MagicLinkKeys } from '@paras/domain';
import type { AuthDeps } from './auth/types.js';
import type { VaultActivitySource } from './envio.js';
import type { GeoResolver } from './jurisdiction.js';
import type { NearIntents } from './near-intents.js';
import type { VaultReader } from './vault.js';

export interface MagicLinkDeps {
  /** Signing keys by kid (rotation: add a key, switch `activeKid`, drop old keys after their TTL). */
  keys: MagicLinkKeys;
  /** Public web app origin used to build shareable URLs (WEB_BASE_URL). */
  webBaseUrl: string;
  defaultTtlMs: number;
  maxTtlMs: number;
  now: () => Date;
}

export interface OAuthDeps {
  /** Public origin of this API (OAuth issuer / metadata base). */
  issuer: string;
  /** Web consent page; when set, /oauth/authorize redirects there instead of the plain fallback. */
  consentUrl?: string;
  /** Dynamic client registration per IP (default 20/hour). */
  registerLimit?: { max: number; windowMs: number };
  /** Cap on registered clients nobody has authorized yet (default 1000). */
  maxUnusedClients?: number;
}

/** Everything routes may touch. Tests build this with a fresh DB and fake adapters. */
export interface AppDeps {
  db: Database;
  adapters: AdapterRegistry;
  auth: AuthDeps;
  magicLinks: MagicLinkDeps;
  /** OAuth AS settings; defaults to localhost. */
  oauth?: OAuthDeps;
  /** Embeds search queries for semantic search. Omit for full-text only. */
  embedder?: Embedder;
  /** Country resolver; default trusts the CDN country header. */
  geo?: GeoResolver;
  /** Monad Vault reader; omit and the balance endpoint answers 503. */
  vault?: VaultReader;
  /** 1Click client; set only on mainnet, else the any-chain deposit routes answer 404 feature_disabled. */
  nearIntents?: NearIntents;
  /** Privy client + Paras's session-signer key-quorum id; omit and Privy endpoints answer 503. */
  privy?: { port: PrivyPort; signerId: string };
  /** Envio GraphQL source for Vault deposits/withdrawals; omit to read the polled table. */
  activity?: VaultActivitySource;
  /** Wall clock, injectable for freshness tests. */
  now?: () => Date;
  /** Overrides for the Feed scorer weights (defaults: DEFAULT_FEED_WEIGHTS). */
  feedWeights?: Partial<FeedWeights>;
  /** How often SSE streams re-read latest Quotes from Postgres. Default 2000 ms. */
  ssePollMs?: number;
}

/** A Quote older than this is flagged `stale` in API responses. */
export const QUOTE_STALE_AFTER_MS = 2 * 60_000;
