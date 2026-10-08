import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createFakeAdapter, fakeMarket } from '@paras/adapters';
import { upsertMarkets, upsertVenue } from '@paras/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, injectFetch, type TestApp } from '../../api/test/harness.js';
import { buildApp } from '../src/app.js';

// Test-only loose JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

let t: TestApp;
let url: string;
const app = (fetch: typeof globalThis.fetch) => buildApp({ apiUrl: 'http://api.test', fetch });
let mcp: ReturnType<typeof buildApp>;

beforeAll(async () => {
  const poly = createFakeAdapter({
    id: 'polymarket',
    name: 'Polymarket',
    capabilities: { routable: true, regulation: 'offshore', restrictedJurisdictions: ['US'] },
    markets: [fakeMarket('p1', { venueId: 'polymarket' })],
  });
  t = await createTestApp({ adapters: [poly] });
  await upsertVenue(t.db, poly);
  await upsertMarkets(t.db, (await poly.listMarkets({ status: 'all' })).items);
  mcp = app(injectFetch(t.app));
  url = await mcp.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(async () => {
  await mcp.close();
  await t.close();
});

async function connect(headers: Record<string, string> = {}) {
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers } }),
  );
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  expect(res.isError).toBeFalsy();
  return JSON.parse((res.content as { text: string }[])[0]!.text) as Json;
}

describe('mcp', () => {
  it('serves /health', async () => {
    const res = await fetch(`${url}/health`);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('exposes only read tools (public + personal) plus create_magic_link: nothing that trades or moves money', async () => {
    const client = await connect();
    const names = (await client.listTools()).tools.map((x) => x.name).sort();
    expect(names).toEqual([
      'compare_prices',
      'create_magic_link',
      'get_event',
      'get_my_feed',
      'get_portfolio',
      'list_closing_soon',
      'list_trending',
      'search_events',
    ]);
    expect(names.join()).not.toMatch(/trade|bet|order|deposit|withdraw|execute|sign|place/);
    await client.close();
  });

  it('search_events returns Events with a resolvable Magic Link and availability', async () => {
    const client = await connect({ 'cf-ipcountry': 'IN' });
    const r = await call(client, 'search_events', { source: 'codex' });
    expect(r.items.length).toBeGreaterThan(0);
    const ev = r.items[0];
    expect(ev.markets[0].availability).toBe('routable');
    const token = new URL(ev.magicLink).pathname.replace('/magic/', '');
    const resolved = await t.client.resolveMagicLink({ params: { token } });
    expect(resolved.event.id).toBe(ev.id);
    expect(resolved.source).toBe('codex');
    await client.close();
  });

  it('forwards the caller country: US sees Polymarket blocked', async () => {
    const client = await connect({ 'cf-ipcountry': 'US' });
    const r = await call(client, 'list_trending');
    expect(r.items[0].markets[0].availability).toBe('blocked');
    await client.close();
  });

  it('get_event, list_closing_soon, compare_prices, create_magic_link', async () => {
    const client = await connect();
    const id = (await call(client, 'search_events')).items[0].id as string;
    expect((await call(client, 'get_event', { eventId: id })).id).toBe(id);
    expect((await call(client, 'list_closing_soon')).items.length).toBeGreaterThan(0);
    expect((await call(client, 'compare_prices', { eventId: id })).eventId).toBe(id);
    const link = await call(client, 'create_magic_link', {
      eventId: id,
      outcome: 'Yes',
      amount: '25',
      source: 'claude',
    });
    const token = link.token as string;
    const resolved = await t.client.resolveMagicLink({ params: { token } });
    expect(resolved).toMatchObject({ outcome: 'Yes', amount: '25', source: 'claude' });
    await client.close();
  });
});
