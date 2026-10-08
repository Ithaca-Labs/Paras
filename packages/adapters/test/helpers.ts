import { NormalizedMarket, PricePoint, Quote, VenueCapabilities } from '@paras/shared';
import { createFixtureFetch } from '@paras/testkit';
import { expect } from 'vitest';
import type { VenueAdapter } from '../src/index.js';

/** Fixtures were recorded at this instant; adapters get it as `now` so replay URLs match. */
export const NOW = () => new Date('2026-10-08T22:40:00Z');

export const fixtures = (venue: string) =>
  createFixtureFetch({ dir: new URL(`./fixtures/${venue}/`, import.meta.url) });

/** Hand-written responses (venue docs) keyed by URL substring; anything else throws. */
export function stubFetch(routes: Record<string, unknown>): typeof fetch {
  return async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) throw new Error(`stubFetch: no route for ${url}`);
    return new Response(JSON.stringify(hit[1]), {
      headers: { 'content-type': 'application/json' },
    });
  };
}

export interface VenueCheck {
  venueId: string;
  /** Markets to list. */
  limit?: number;
  url?: RegExp;
  /** Expect a price series for the first Outcome of the sampled Market. */
  history?: boolean;
}

/** The shared external-behavior contract every Venue adapter must meet. */
export async function checkVenue(adapter: VenueAdapter, c: VenueCheck) {
  expect(adapter.id).toBe(c.venueId);
  expect(VenueCapabilities.parse(adapter.capabilities)).toMatchObject({
    routable: false,
    realMoney: true,
  });

  const page = await adapter.listMarkets({ limit: c.limit ?? 10 });
  expect(page.items.length).toBeGreaterThan(0);
  const ids = new Set<string>();
  for (const m of page.items) {
    expect(NormalizedMarket.parse(m)).toEqual(m);
    expect(m.venueId).toBe(c.venueId);
    expect(m.status).toBe('open');
    if (c.url) expect(m.url).toMatch(c.url);
    expect(adapter.deepLink(m)).toBe(m.url);
    expect(m.outcomes.length).toBeGreaterThanOrEqual(2);
    for (const o of m.outcomes) {
      expect(ids.has(o.externalId)).toBe(false);
      ids.add(o.externalId);
    }
  }

  // First of the first few Markets that has a live quote.
  let sample: NormalizedMarket | undefined;
  let quotes: Quote[] = [];
  for (const m of page.items.slice(0, 5)) {
    quotes = await adapter.fetchQuotes(m.outcomes.map((o) => o.externalId));
    if (quotes.some((q) => q.bid !== null || q.ask !== null)) {
      sample = m;
      break;
    }
  }
  expect(sample, 'no sampled Market had a quote').toBeDefined();
  for (const q of quotes) {
    Quote.parse(q);
    expect(sample!.outcomes.map((o) => o.externalId)).toContain(q.outcomeExternalId);
    if (q.bid !== null && q.ask !== null) expect(Number(q.bid)).toBeLessThanOrEqual(Number(q.ask));
  }

  if (c.history) {
    // Some Markets are idle and have no series: take the first with one.
    let points: PricePoint[] = [];
    for (const m of [sample!, ...page.items.slice(0, 5)]) {
      points = await adapter.fetchPriceHistory(m.outcomes[0]!.externalId, { interval: '1d' });
      if (points.length) break;
    }
    expect(points.length).toBeGreaterThan(0);
    points.forEach((p) => PricePoint.parse(p));
    expect(points.map((p) => p.ts)).toEqual(points.map((p) => p.ts).sort());
  } else {
    expect(adapter.capabilities.priceHistory).toBe(false);
    expect(await adapter.fetchPriceHistory('x', { interval: '1d' })).toEqual([]);
  }
  return { page, sample: sample!, quotes };
}
