import { ErrorResponse } from './errors.js';
import type { Route, RouteInput, RouteResult } from './route.js';
import { apiRoutes, type ApiRoutes } from './routes/index.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorResponse | undefined,
  ) {
    super(body?.error.message ?? `HTTP ${status}`);
  }
}

export interface ClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

type Call<R extends Route> = keyof RouteInput<R> extends never
  ? () => Promise<RouteResult<R>>
  : (input: RouteInput<R>) => Promise<RouteResult<R>>;

export type ApiClient = { [K in keyof ApiRoutes]: Call<ApiRoutes[K]> };

type AnyInput = { params?: Record<string, unknown>; query?: Record<string, unknown>; body?: unknown };

/** Typed client generated from the same route definitions the api implements. */
export function createApiClient(options: ClientOptions): ApiClient {
  const doFetch = options.fetch ?? fetch;
  const client: Record<string, unknown> = {};
  for (const [name, route] of Object.entries(apiRoutes) as [string, Route][]) {
    client[name] = async (input: AnyInput = {}) => {
      const path = route.path.replace(/\{(\w+)\}/g, (_, k: string) =>
        encodeURIComponent(String(input.params?.[k])),
      );
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(input.query ?? {})) {
        if (v !== undefined) qs.set(k, String(v));
      }
      const url = options.baseUrl.replace(/\/$/, '') + path + (qs.size ? `?${qs}` : '');
      const res = await doFetch(url, {
        method: route.method.toUpperCase(),
        headers: {
          ...(input.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...options.headers,
        },
        body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
      });
      const data: unknown = await res.json().catch(() => undefined);
      if (!res.ok) throw new ApiError(res.status, ErrorResponse.safeParse(data).data);
      return route.response.parse(data);
    };
  }
  return client as ApiClient;
}
