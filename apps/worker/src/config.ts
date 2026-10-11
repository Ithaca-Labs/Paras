import { z } from '@paras/shared';

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  WORKER_PORT: z.coerce.number().int().default(3001),
  /** Hugging Face sentence model (384 dims), or `off` to skip embedding/tagging. */
  EMBEDDING_MODEL: z.string().default('Xenova/all-MiniLM-L6-v2'),
  EMBEDDING_CACHE_DIR: z.string().default('/tmp/paras-models'),
  /** Polymarket CLOB WebSocket Quote streaming; `off` leaves polling only. */
  QUOTE_STREAM: z.enum(['on', 'off']).default('on'),
  /** Nansen API key; unset disables smart-money refresh. */
  NANSEN_API_KEY: z.string().optional(),
  /** Max Nansen credits per UTC day (free tier ~10; keep a margin). */
  NANSEN_DAILY_CAP: z.coerce.number().int().positive().default(8),
  /** Hours before a Market's smart-money signal is refetched. */
  NANSEN_TTL_HOURS: z.coerce.number().positive().default(24),
  EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Paras <login@paras.local>'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export const loadConfig = (env: NodeJS.ProcessEnv = process.env) => Env.parse(env);
