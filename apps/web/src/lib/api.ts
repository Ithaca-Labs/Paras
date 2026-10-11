import { createApiClient } from '@paras/shared';
import { geoOverride } from './geo';

/**
 * The only way web talks to the API: the typed client generated from packages/shared routes.
 * Browser: relative `/v1/*` (next.config rewrites to the API, so the session cookie is same-origin).
 * Server components: direct to API_URL, forwarding no cookies (public reads). Use `serverApi(cookie)`
 * for per-User reads.
 */
export const api = createApiClient({ baseUrl: '' });

/** Forwards the visitor's CDN country so server-rendered availability matches the browser's. */
const geoFetch: typeof fetch = async (input, init) => {
  let geo: Record<string, string> = {};
  try {
    geo = geoOverride(await (await import('next/headers')).headers());
  } catch {
    /* outside a request scope (tests, build) */
  }
  const h = new Headers(init?.headers);
  for (const [k, v] of Object.entries(geo)) h.set(k, v);
  return fetch(input, { ...init, headers: h });
};

export const serverApi = (cookie?: string) =>
  createApiClient({
    baseUrl: process.env.API_URL ?? 'http://localhost:3000',
    headers: cookie ? { cookie } : undefined,
    fetch: geoFetch,
  });
