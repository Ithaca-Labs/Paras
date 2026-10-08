import type { Mailer } from './mailer.js';

export interface AuthConfig {
  /** HMAC key for email codes. */
  secret: string;
  /** SIWE `domain` (RFC 3986 authority, e.g. `paras.app` or `localhost:3000`) the message must carry. */
  domain: string;
  /** Accepted SIWE chain ids (Monad mainnet 143, testnet 10143 by default). */
  chainIds: number[];
  secureCookie: boolean;
  sessionTtlMs: number;
  nonceTtlMs: number;
  codeTtlMs: number;
  maxCodeAttempts: number;
  /** Max codes per email per `codeTtlMs` window. */
  maxCodesPerEmail: number;
  /** Max codes per IP per hour. */
  maxCodesPerIp: number;
}

export interface AuthDeps {
  config: AuthConfig;
  mailer: Mailer;
  now: () => Date;
}

export const SESSION_COOKIE = 'paras_session';

export const defaultAuthConfig = (
  over: Partial<AuthConfig> & Pick<AuthConfig, 'secret' | 'domain'>,
): AuthConfig => ({
  chainIds: [143, 10143],
  secureCookie: false,
  sessionTtlMs: 30 * 24 * 3600_000,
  nonceTtlMs: 10 * 60_000,
  codeTtlMs: 10 * 60_000,
  maxCodeAttempts: 5,
  maxCodesPerEmail: 3,
  maxCodesPerIp: 20,
  ...over,
});
