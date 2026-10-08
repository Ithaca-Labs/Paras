import { z } from '@paras/shared';

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export const loadConfig = (env: NodeJS.ProcessEnv = process.env) => Env.parse(env);
export type Config = ReturnType<typeof loadConfig>;
