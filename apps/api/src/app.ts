import { z, type ErrorResponse } from '@paras/shared';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { registerAuthGuard } from './auth/guard.js';
import type { AppDeps } from './deps.js';
import { HttpError } from './errors.js';
import { routePlugins } from './routes/index.js';

export function buildApp(deps: AppDeps, opts: FastifyServerOptions = {}) {
  // Magic Link tokens ride in the path and exceed Fastify's 100-char default param limit.
  const app = Fastify({ maxParamLength: 2048, ...opts });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof z.ZodError) {
      const body: ErrorResponse = {
        error: { code: 'validation_error', message: 'Invalid request', issues: err.issues },
      };
      return reply.status(400).send(body);
    }
    if (err instanceof HttpError) {
      const body: ErrorResponse = { error: { code: err.code, message: err.message } };
      return reply.status(err.statusCode).send(body);
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    const body: ErrorResponse = {
      error: { code: status >= 500 ? 'internal_error' : 'bad_request', message: err.message },
    };
    return reply.status(status).send(body);
  });

  app.setNotFoundHandler((req, reply) => {
    const body: ErrorResponse = {
      error: { code: 'not_found', message: `Route ${req.method} ${req.url} not found` },
    };
    return reply.status(404).send(body);
  });

  registerAuthGuard(app, deps.db, deps.auth);
  for (const plugin of routePlugins) plugin(app, deps);
  return app;
}
