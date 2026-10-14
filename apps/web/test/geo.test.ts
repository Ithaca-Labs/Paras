import { afterEach, describe, expect, it, vi } from 'vitest';
import { geoOverride } from '@/lib/geo';

describe('geoOverride', () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it('forwards CDN country', () => {
    expect(geoOverride(h({ 'x-vercel-ip-country': 'IN' }), {})).toEqual({
      'x-vercel-ip-country': 'IN',
    });
  });
  it('DEV_COUNTRY wins outside production, ignored in production', () => {
    const incoming = h({ 'cf-ipcountry': 'US' });
    expect(geoOverride(incoming, { DEV_COUNTRY: 'in' })).toEqual({ 'cf-ipcountry': 'IN' });
    expect(geoOverride(incoming, { DEV_COUNTRY: 'IN', NODE_ENV: 'production' })).toEqual({
      'cf-ipcountry': 'US',
    });
  });
  it('GEO_SECRET rides along; Vercel country preferred over a client-sent cf-ipcountry', () => {
    const incoming = h({ 'cf-ipcountry': 'US', 'x-vercel-ip-country': 'IN' });
    expect(geoOverride(incoming, { NODE_ENV: 'production', GEO_SECRET: 's' })).toEqual({
      'x-vercel-ip-country': 'IN',
      'x-paras-geo-secret': 's',
    });
  });
});

describe('serverApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.doUnmock('next/headers');
  });
  it('sends the visitor country to the API', async () => {
    vi.doMock('next/headers', () => ({
      headers: async () => new Headers({ 'x-vercel-ip-country': 'IN' }),
    }));
    const fetchMock = vi.fn(async () => new Response('{"items":[]}'));
    vi.stubGlobal('fetch', fetchMock);
    const { serverApi } = await import('@/lib/api');
    await serverApi()
      .listEvents({ query: {} })
      .catch(() => {});
    const init = (fetchMock.mock.calls[0] as unknown as [unknown, RequestInit])[1];
    expect(new Headers(init.headers).get('x-vercel-ip-country')).toBe('IN');
  });
});
