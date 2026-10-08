import { z } from '@paras/shared';

const Env = z.object({
  API_URL: z.string().url().default('http://localhost:3000'),
  /** Public origin of this server, for OAuth protected-resource metadata. */
  MCP_URL: z.string().url().default('http://localhost:3002'),
  /** Public origin of the OAuth authorization server (apps/api); defaults to API_URL. */
  OAUTH_ISSUER: z.string().url().optional(),
  MCP_PORT: z.coerce.number().int().default(3002),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export const loadConfig = (env: NodeJS.ProcessEnv = process.env) => Env.parse(env);
