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
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export const loadConfig = (env: NodeJS.ProcessEnv = process.env) => {
  const cfg = Env.parse(env);
  const prod = env.NODE_ENV === 'production';
  if (prod && !cfg.AUTH_SECRET) throw new Error('AUTH_SECRET is required in production');
  return cfg;
};
export type Config = ReturnType<typeof loadConfig>;
