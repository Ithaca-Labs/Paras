import { toFastifyPath, type Route, type RouteOutput, type RouteRequest } from '@paras/shared';
import type { FastifyInstance } from 'fastify';

/**
 * Bind a handler to a route defined in @paras/shared. Params, query and body are validated
 * against the route's zod schemas (400 on failure) and the response is parsed through the
 * response schema, so the wire format always matches the OpenAPI document.
 */
export function implement<R extends Route>(
  app: FastifyInstance,
  route: R,
  handler: (req: RouteRequest<R>) => Promise<RouteOutput<R>> | RouteOutput<R>,
): void {
  app.route({
    method: route.method.toUpperCase() as Uppercase<R['method']>,
    url: toFastifyPath(route.path),
    handler: async (req, reply) => {
      const input = {
        ...(route.request.params && { params: route.request.params.parse(req.params) }),
        ...(route.request.query && { query: route.request.query.parse(req.query) }),
        ...(route.request.body && { body: route.request.body.parse(req.body) }),
      } as RouteRequest<R>;
      const result = await handler(input);
      return reply.status(route.status ?? 200).send(route.response.parse(result));
    },
  });
}
