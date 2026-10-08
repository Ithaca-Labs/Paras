import { toFastifyPath, type Route, type RouteOutput, type RouteRequest } from '@paras/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthContext } from './auth/guard.js';

export interface HandlerCtx<A = undefined> {
  request: FastifyRequest;
  /** For headers/cookies only; `implement` sends the response. */
  reply: FastifyReply;
  auth: A;
}

type Handler<R extends Route, A> = (
  req: RouteRequest<R>,
  ctx: HandlerCtx<A>,
) => Promise<RouteOutput<R>> | RouteOutput<R>;

/**
 * Bind a handler to a route defined in @paras/shared. Params, query and body are validated
 * against the route's zod schemas (400 on failure) and the response is parsed through the
 * response schema, so the wire format always matches the OpenAPI document.
 *
 * Auth: `{ auth: 'required' }` answers 401 for signed-out callers and gives the handler
 * `ctx.auth` (userId, ...). `{ auth: 'optional' }` gives `AuthContext | null`.
 */
export function implement<R extends Route>(
  app: FastifyInstance,
  route: R,
  handler: Handler<R, undefined>,
): void;
export function implement<R extends Route>(
  app: FastifyInstance,
  route: R,
  handler: Handler<R, AuthContext>,
  opts: { auth: 'required' },
): void;
export function implement<R extends Route>(
  app: FastifyInstance,
  route: R,
  handler: Handler<R, AuthContext | null>,
  opts: { auth: 'optional' },
): void;
export function implement<R extends Route>(
  app: FastifyInstance,
  route: R,
  handler: Handler<R, never>,
  opts?: { auth?: 'required' | 'optional' },
): void {
  app.route({
    method: route.method.toUpperCase() as Uppercase<R['method']>,
    url: toFastifyPath(route.path),
    handler: async (req, reply) => {
      const auth =
        opts?.auth === 'required'
          ? await app.requireUser(req)
          : opts?.auth === 'optional'
            ? await app.authenticate(req)
            : undefined;
      const input = {
        ...(route.request.params && { params: route.request.params.parse(req.params) }),
        ...(route.request.query && { query: route.request.query.parse(req.query) }),
        ...(route.request.body && { body: route.request.body.parse(req.body) }),
      } as RouteRequest<R>;
      const result = await handler(input, { request: req, reply, auth } as HandlerCtx<never>);
      return reply.status(route.status ?? 200).send(route.response.parse(result));
    },
  });
}
