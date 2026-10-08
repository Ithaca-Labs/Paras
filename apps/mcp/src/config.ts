import { z } from '@paras/shared';

const Env = z.object({
  API_URL: z.string().url().default('http://localhost:3000'),
  MCP_PORT: z.coerce.number().int().default(3002),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export const loadConfig = (env: NodeJS.ProcessEnv = process.env) => Env.parse(env);
