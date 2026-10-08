import { createFakeAdapter, fakeMarket, type FakeAdapter } from '@paras/adapters';
import { upsertMarkets, upsertVenue } from '@paras/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness.js';

let t: TestApp;
const venues: FakeAdapter[] = [];

beforeAll(async () => {
  const mk = (
    id: string,
    caps: Parameters<typeof createFakeAdapter>[0] extends infer O ? O : never,
  ) => createFakeAdapter({ id, name: id, ...caps });
  venues.push(
    mk('core', {
      capabilities: { routable: true, regulation: 'offshore', restrictedJurisdictions: ['US'] },
      markets: [fakeMarket('real', { venueId: 'core', volume: '100' })],
    }),
    mk('cftc-venue', {
      capabilities: { routable: false, regulation: 'cftc_regulated', restrictedJurisdictions: [] },
      markets: [fakeMarket('us', { venueId: 'cftc-venue', volume: '50' })],
    }),
    mk('play', {
      capabilities: { routable: false, realMoney: false, regulation: 'play_money' },
      markets: [fakeMarket('toy', { venueId: 'play', volume: '9999' })],
    }),
  );
  t = await createTestApp({ adapters: venues });
  for (const v of venues) {
    await upsertVenue(t.db, v);
    await upsertMarkets(t.db, (await v.listMarkets()).items);
  }
});
afterAll(() => t.close());

describe('GET /v1/venues', () => {
  it('labels every Venue with regulation and availability', async () => {
    const { items } = await t.client.listVenues();
    const byId = Object.fromEntries(items.map((v) => [v.id, v.label]));
    expect(byId).toEqual({
      core: { regulation: 'offshore', availability: 'routable', text: 'Offshore, US restricted' },
      'cftc-venue': {
        regulation: 'cftc_regulated',
        availability: 'redirect_only',
        text: 'CFTC-regulated, US OK',
      },
      play: {
        regulation: 'play_money',
        availability: 'play_money',
        text: 'Play money, no real funds',
      },
    });
  });
});

describe('play-money Venues', () => {
  it('are hidden from Events by default and shown, labeled, on opt-in', async () => {
    const def = await t.client.listEvents({ query: {} });
    expect(def.items.map((e) => e.title).sort()).toEqual(['Will real happen?', 'Will us happen?']);

    const all = await t.client.listEvents({ query: { includePlayMoney: 'true' } });
    const toy = all.items.find((e) => e.title === 'Will toy happen?')!;
    expect(toy.markets[0]!.venue.label.availability).toBe('play_money');
  });
});
