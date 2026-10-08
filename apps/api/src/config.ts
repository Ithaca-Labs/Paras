import type { MagicLinkKeys } from '@paras/domain';
import { z } from '@paras/shared';

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().default(3000),
  /** HMAC key for email codes. Required in production; dev falls back to a fixed value. */
  AUTH_SECRET: z.string().min(32).optional(),
  /** SIWE domain (host[:port]) the signed message must carry. */
  AUTH_DOMAIN: z.string().default('localhost:3000'),
  /** Comma-separated accepted SIWE chain ids (Monad mainnet 143, testnet 10143). */
  AUTH_CHAIN_IDS: z.string().default('143,10143'),
  AUTH_COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Paras <login@paras.local>'),
  /** Public web app origin for Magic Link URLs (the web app is built later). */
  WEB_BASE_URL: z.string().url().default('http://localhost:5173'),
  /** Comma-separated `kid:secret` pairs (secret >= 32 chars). Required in production. */
  MAGIC_LINK_KEYS: z.string().optional(),
  /** Key used to sign new links; defaults to the first in MAGIC_LINK_KEYS. */
  MAGIC_LINK_ACTIVE_KID: z.string().optional(),
  MAGIC_LINK_TTL_SECONDS: z.coerce.number().int().min(60).default(3600),
  MAGIC_LINK_MAX_TTL_SECONDS: z.coerce.number().int().min(60).default(86400),
  /** Hugging Face sentence model (384 dims) for semantic search, or `off` for full-text only. */
  EMBEDDING_MODEL: z.string().default('Xenova/all-MiniLM-L6-v2'),
  EMBEDDING_CACHE_DIR: z.string().default('/tmp/paras-models'),
  /** Monad RPC + Vault proxy for the balance endpoint; both unset = endpoint answers 503. */
  MONAD_RPC_URL: z.string().url().optional(),
  VAULT_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
  VAULT_CHAIN_ID: z.coerce.number().int().default(10143),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export const loadConfig = (env: NodeJS.ProcessEnv = process.env) => {
  const cfg = Env.parse(env);
  const prod = env.NODE_ENV === 'production';
  if (prod && !cfg.AUTH_SECRET) throw new Error('AUTH_SECRET is required in production');
  if (prod && !cfg.MAGIC_LINK_KEYS) throw new Error('MAGIC_LINK_KEYS is required in production');
  return cfg;
};

/** Parses `kid:secret,kid2:secret2`; dev falls back to a fixed key. */
export const loadMagicLinkKeys = (cfg: Config): MagicLinkKeys => {
  const keys: Record<string, string> = {};
  const kids: string[] = [];
  for (const pair of (cfg.MAGIC_LINK_KEYS ?? 'dev:dev-only-insecure-magic-link-key-0000').split(
    ',',
  )) {
    const i = pair.indexOf(':');
    const kid = pair.slice(0, i).trim();
    const secret = pair.slice(i + 1).trim();
    if (i < 1 || secret.length < 32) {
      if (cfg.MAGIC_LINK_KEYS)
        throw new Error('MAGIC_LINK_KEYS entries must be kid:secret (>=32 chars)');
    }
    keys[kid] = secret;
    kids.push(kid);
  }
  const activeKid = cfg.MAGIC_LINK_ACTIVE_KID ?? kids[0]!;
  if (!keys[activeKid])
    throw new Error(`MAGIC_LINK_ACTIVE_KID ${activeKid} not in MAGIC_LINK_KEYS`);
  return { activeKid, keys };
};
export type Config = ReturnType<typeof loadConfig>;
