import type { z } from './zod.js';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface RequestSchemas {
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
}

export interface Route<
  Req extends RequestSchemas = RequestSchemas,
  Res extends z.ZodType = z.ZodType,
> {
  method: HttpMethod;
  /** OpenAPI-style path, e.g. `/v1/events/{id}`. */
  path: string;
  operationId: string;
  summary?: string;
  tags?: string[];
  request: Req;
  /** Success status, default 200. Errors use the shared ErrorResponse. */
  status?: 200 | 201;
  response: Res;
}

/** Declares an API route once; the api implements it, OpenAPI and the typed client derive from it. */
export function defineRoute<Req extends RequestSchemas, Res extends z.ZodType>(
  route: Route<Req, Res>,
): Route<Req, Res> {
  return route;
}

type Present<Req extends RequestSchemas, F extends 'input' | 'output'> = {
  [K in keyof Req as Req[K] extends z.ZodType ? K : never]: Req[K] extends z.ZodType
    ? F extends 'input'
      ? z.input<Req[K]>
      : z.output<Req[K]>
    : never;
};

/** What a caller sends (client side). */
export type RouteInput<R extends Route> = Present<R['request'], 'input'>;
/** What a handler receives after validation (server side). */
export type RouteRequest<R extends Route> = Present<R['request'], 'output'>;
/** What a handler returns / the client receives. */
export type RouteOutput<R extends Route> = z.input<R['response']>;
export type RouteResult<R extends Route> = z.output<R['response']>;

/** Express `/v1/events/{id}` as Fastify `/v1/events/:id`. */
export function toFastifyPath(path: string): string {
  return path.replace(/\{(\w+)\}/g, ':$1');
}
