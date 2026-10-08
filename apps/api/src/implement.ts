import {
  toFastifyPath,
  type Route,
  type RouteOutput,
  type RouteRequest,
  type SseRequest,
  type SseRoute,
} from '@paras/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { OAuthScope } from '@paras/domain';
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
 * `ctx.auth` (userId, ...). `{ auth: 'optional' }` gives `AuthContext | null`. Add `scope` to also
 * accept OAuth access tokens holding it (never do this for routes that write or move money).
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
  opts: { auth: 'required'; scope?: OAuthScope },
): void;
export function implement<R extends Route>(
  app: FastifyInstance,
  route: R,
  handler: Handler<R, AuthContext | null>,
  opts: { auth: 'optional'; scope?: OAuthScope },
): void;
export function implement<R extends Route>(
  app: FastifyInstance,
  route: R,
  handler: Handler<R, never>,
  opts?: { auth?: 'required' | 'optional'; scope?: OAuthScope },
): void {
  app.route({
    method: route.method.toUpperCase() as Uppercase<R['method']>,
    url: toFastifyPath(route.path),
    handler: async (req, reply) => {
      // `scope` additionally lets OAuth access tokens (MCP clients) in; see authenticateScoped.
      const scoped = opts?.scope;
      const auth =
        opts?.auth === 'required'
          ? scoped
            ? ((await app.authenticateScoped(req, scoped)) ?? (await app.requireUser(req)))
            : await app.requireUser(req)
          : opts?.auth === 'optional'
            ? scoped
              ? await app.authenticateScoped(req, scoped)
              : await app.authenticate(req)
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

/** Push one SSE message: `event: <name>` plus JSON `data:` validated against the route's schema. */
export type SseEmit = (event: string, data: unknown) => void;
/** Starts producing messages; returns the function that stops them. */
export type SseSubscribe = (emit: SseEmit) => () => void;

const KEEPALIVE_MS = 15_000;

/**
 * Bind an SSE route. The handler validates and may throw (404 etc.) before the stream opens;
 * it returns a `subscribe` function that pushes messages until the client disconnects or the
 * app closes.
 */
export function implementSse<R extends SseRoute>(
  app: FastifyInstance,
  route: R,
  handler: (req: SseRequest<R>) => Promise<SseSubscribe>,
): void {
  const open = new Set<() => void>();
  app.addHook('onClose', async () => {
    for (const close of [...open]) close();
  });

  app.route({
    method: 'GET',
    url: toFastifyPath(route.path),
    handler: async (req, reply) => {
      const input = {
        ...(route.request.params && { params: route.request.params.parse(req.params) }),
        ...(route.request.query && { query: route.request.query.parse(req.query) }),
      } as SseRequest<R>;
      const subscribe = await handler(input);

      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write(': connected\n\n');

      let unsubscribe = () => {};
      const keepalive = setInterval(() => res.write(': ping\n\n'), KEEPALIVE_MS);
      const close = () => {
        if (!open.delete(close)) return;
        clearInterval(keepalive);
        unsubscribe();
        res.end();
      };
      open.add(close);
      req.raw.on('close', close);
      unsubscribe = subscribe((event, data) => {
        if (res.writableEnded) return;
        res.write(`event: ${event}\ndata: ${JSON.stringify(route.event.parse(data))}\n\n`);
      });
    },
  });
}
