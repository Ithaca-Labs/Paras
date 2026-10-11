import { createApiClient } from '@paras/shared';

/**
 * The only way web talks to the API: the typed client generated from packages/shared routes.
 * Browser: relative `/v1/*` (next.config rewrites to the API, so the session cookie is same-origin).
 * Server components: direct to API_URL, forwarding no cookies (public reads). Use `serverApi(cookie)`
 * for per-User reads.
 */
export const api = createApiClient({ baseUrl: '' });

export const serverApi = (cookie?: string) =>
  createApiClient({
    baseUrl: process.env.API_URL ?? 'http://localhost:3000',
    headers: cookie ? { cookie } : undefined,
  });
