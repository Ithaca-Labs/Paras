import { z } from '@paras/shared';

const Env = z.object({
  EXECUTOR_PORT: z.coerce.number().int().default(3003),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Mainnet requires the KMS key backend. */
  EXECUTOR_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
  EXECUTOR_KEY_BACKEND: z.enum(['env', 'kms']).default('env'),
  /** 32 bytes hex. Encrypts session keys at rest (testnet only). */
  EXECUTOR_MASTER_KEY: z.string().optional(),
  POLYGON_RPC_URL: z.string().url().optional(),
  POLYMARKET_RELAYER_URL: z.string().url().default('https://relayer-v2.polymarket.com'),
  /** Builder credentials (HITL #35). Required for live relayer calls. */
  POLYMARKET_BUILDER_API_KEY: z.string().optional(),
  POLYMARKET_BUILDER_SECRET: z.string().optional(),
  POLYMARKET_BUILDER_PASSPHRASE: z.string().optional(),
});

export const loadConfig = (env: NodeJS.ProcessEnv = process.env) => Env.parse(env);
export type ExecutorConfig = ReturnType<typeof loadConfig>;
