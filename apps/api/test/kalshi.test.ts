import { createKalshiAdapter } from '@paras/adapters';
import { recordQuotes, upsertMarkets, upsertVenue } from '@paras/db';
import { createFixtureFetch } from '@paras/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness.js';

const clock = new Date('2026-10-09T12:00:00Z');
const kalshi = createKalshiAdapter({
  // Same recorded Kalshi responses the adapter test replays; never hits the network.
  fetch: createFixtureFetch({
    dir: new URL('../../../packages/adapters/test/fixtures/kalshi/', import.meta.url),
  }),
  now: () => clock,
});

let t: TestApp;
let quotedTicker: string;
beforeAll(async () => {
  t = await createTestApp({ adapters: [kalshi], now: () => clock });
  // Ingest the way the worker does: sync Markets, then poll Quotes.
  const { items } = await kalshi.listMarkets({ limit: 5 });
  await upsertVenue(t.db, kalshi);
  await upsertMarkets(t.db, items);
  quotedTicker = items[0]!.externalId;
  const ids = items[0]!.outcomes.map((o) => o.externalId);
  await recordQuotes(t.db, 'kalshi', await kalshi.fetchQuotes(ids), { now: clock });
});
afterAll(() => t.close());

describe('Kalshi in the Event API', () => {
  it('lists Kalshi Markets as Events, non-routable, with the exact Kalshi redirectUrl', async () => {
    const { items } = await t.client.listEvents({ query: { venue: 'kalshi' } });
    expect(items.length).toBeGreaterThan(0);
    for (const event of items) {
      const m = event.markets[0]!;
      expect(m.venue).toMatchObject({
        id: 'kalshi',
        capabilities: {
          routable: false,
          regulation: 'cftc_regulated',
          restrictedJurisdictions: [],
        },
      });
      expect(m.redirectUrl).toMatch(
        /^https:\/\/kalshi\.com\/markets\/[a-z0-9]+\/[a-z0-9-]*\/[a-z0-9-]+$/,
      );
      expect(m.redirectUrl).toBe(m.url);
    }
    const elon = items.find((e) => e.markets[0]!.externalId === 'KXELONMARS-99')!;
    expect(elon.markets[0]!.redirectUrl).toBe(
      'https://kalshi.com/markets/kxelonmars/will-elon-musk-visit-mars-in-his-lifetime/kxelonmars-99',
    );
  });

  it('serves polled Quotes for a Kalshi Market', async () => {
    const { items } = await t.client.listEvents({ query: { venue: 'kalshi' } });
    const quoted = items.find((e) => e.markets[0]!.externalId === quotedTicker)!;
    expect(quoted.markets[0]!.stale).toBe(false);
    expect(quoted.markets[0]!.outcomes.map((o) => o.label)).toEqual(['Yes', 'No']);
    expect(quoted.markets[0]!.outcomes.every((o) => o.quote !== null)).toBe(true);
  });
});
