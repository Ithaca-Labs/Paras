import { z } from '@paras/shared';

const Env = z.object({
  EXECUTOR_PORT: z.coerce.number().int().default(3003),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export const loadConfig = (env: NodeJS.ProcessEnv = process.env) => Env.parse(env);
