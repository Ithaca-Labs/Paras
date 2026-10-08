import { z } from '@paras/shared';

const Env = z.object({
  EXECUTOR_PORT: z.coerce.number().int().default(3003),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Mainnet requires the KMS key backend. */
  EXECUTOR_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
  EXECUTOR_KEY_BACKEND: z.enum(['env', 'kms']).default('env'),
  /** 32 bytes hex. Encrypts session keys at rest (testnet only). */
  EXECUTOR_MASTER_KEY: z.string().optional(),
  /**
   * Run the Intent engine. Needs everything below (incl. builder credentials and code, #35), so it is off by
   * default and /health-only deployments keep working.
   */
  EXECUTOR_INTENTS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  DATABASE_URL: z.string().optional(),
  /** Executor key: EXECUTOR_ROLE on the Vault, pays gas for CCTP mints. */
  EXECUTOR_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
  MONAD_RPC_URL: z.string().url().optional(),
  VAULT_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
  VAULT_CHAIN_ID: z.coerce.number().int().optional(),
  /** Block the Vault was deployed at: where event scans start. */
  VAULT_START_BLOCK: z.coerce.number().int().default(0),
  /** CCTP MessageTransmitterV2 on Monad (same address on every CCTP v2 mainnet). */
  MONAD_MESSAGE_TRANSMITTER: z.string().default('0x81D40F21F12A8F0E3252Bccb954D722d4c464B64'),
  IRIS_URL: z.string().url().default('https://iris-api.circle.com'),
  POLYGON_RPC_URL: z.string().url().optional(),
  POLYMARKET_CLOB_URL: z.string().url().default('https://clob.polymarket.com'),
  /** Paras builder code (bytes32) attached to every order for attribution (HITL #35). */
  POLYMARKET_BUILDER_CODE: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
  /** First block the Polygon indexer scans when it has no cursor yet (default: current head). */
  POLYGON_START_BLOCK: z.coerce.number().int().optional(),
  POLYMARKET_RELAYER_URL: z.string().url().default('https://relayer-v2.polymarket.com'),
  /** Builder credentials (HITL #35). Required for live relayer calls. */
  POLYMARKET_BUILDER_API_KEY: z.string().optional(),
  POLYMARKET_BUILDER_SECRET: z.string().optional(),
  POLYMARKET_BUILDER_PASSPHRASE: z.string().optional(),
});

export const loadConfig = (env: NodeJS.ProcessEnv = process.env) => Env.parse(env);
export type ExecutorConfig = ReturnType<typeof loadConfig>;
