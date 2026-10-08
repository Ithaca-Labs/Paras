import { createFakeAdapter, fakeMarket, type FakeAdapter } from '@paras/adapters';
import { recordQuotes, schema, upsertMarkets, upsertVenue } from '@paras/db';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness.js';

const T0 = new Date('2026-10-09T12:00:00Z');
let clock = T0;
let t: TestApp;
let a: FakeAdapter; // no fees
let b: FakeAdapter; // Kalshi-style 0.07 quadratic fee

const level = (price: string, size: string) => ({ price, size });
const curve = { kind: 'curve', rate: '0.07', exponent: 1, takerOnly: true } as const;

/** Event id a Market was seeded into. */
async function eventOf(externalId: string) {
  const [row] = await t.db
    .select({ eventId: schema.eventMarkets.eventId })
    .from(schema.eventMarkets)
    .innerJoin(schema.markets, eq(schema.markets.id, schema.eventMarkets.marketId))
    .where(eq(schema.markets.externalId, externalId));
  return row!.eventId;
}

/** Manually link a Market into an Event (automatic matching is #6). */
async function link(
  externalId: string,
  eventId: string,
  extra: Partial<typeof schema.eventMarkets.$inferInsert> = {},
) {
  const [m] = await t.db
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.externalId, externalId));
  const old = await t.db
    .select()
    .from(schema.eventMarkets)
    .where(eq(schema.eventMarkets.marketId, m!.id));
  await t.db.delete(schema.eventMarkets).where(eq(schema.eventMarkets.marketId, m!.id));
  if (old[0] && old[0].eventId !== eventId) {
    await t.db.delete(schema.events).where(eq(schema.events.id, old[0].eventId));
  }
  await t.db.insert(schema.eventMarkets).values({ eventId, marketId: m!.id, ...extra });
}

async function ingest(...venues: FakeAdapter[]) {
  for (const v of venues) {
    const { items } = await v.listMarkets({ status: 'all' });
    await upsertVenue(t.db, v);
    await upsertMarkets(t.db, items);
    const ids = items.flatMap((m) => m.outcomes.map((o) => o.externalId));
    await recordQuotes(t.db, v.id, await v.fetchQuotes(ids), { now: clock });
  }
}

beforeAll(async () => {
  const mk = (venueId: string, id: string, fee = fakeMarket(id).fee, vol = '1000') =>
    fakeMarket(id, { venueId, fee, volume: vol, url: `https://${venueId}.example/${id}` });
  a = createFakeAdapter({
    id: 'va',
    name: 'Venue A',
    capabilities: { routable: true },
    now: () => clock,
    markets: [
      mk('va', 'x', undefined, '9000'),
      mk('va', 'div', undefined, '9000'),
      mk('va', 'inv', undefined, '9000'),
      mk('va', 'alice', undefined, '9000'),
      mk('va', 'bob', undefined, '8000'),
    ],
  });
  b = createFakeAdapter({
    id: 'vb',
    name: 'Venue B',
    now: () => clock,
    markets: [
      mk('vb', 'x2', curve),
      mk('vb', 'div2', curve),
      mk('vb', 'inv2'),
      mk('vb', 'alice2', curve, '1500'),
      mk('vb', 'bob2', curve),
    ],
  });
  // Event X: A is flat 0.50; B has a cheap top level (0.48 x10) then 0.70.
  a.setBook('x-yes', {
    bids: [level('0.48', '500')],
    asks: [level('0.50', '50'), level('0.60', '1000')],
  });
  a.setBook('x-no', { bids: [level('0.38', '500')], asks: [level('0.52', '500')] });
  b.setBook('x2-yes', {
    bids: [level('0.46', '500')],
    asks: [level('0.48', '10'), level('0.70', '1000')],
  });
  b.setBook('x2-no', { bids: [level('0.30', '500')], asks: [level('0.55', '500')] });
  // Divergent pair.
  a.setBook('div-yes', { bids: [level('0.29', '10')], asks: [level('0.31', '10')] });
  b.setBook('div2-yes', { bids: [level('0.49', '10')], asks: [level('0.51', '10')] });
  // Inverse: B's YES is the Event's NO.
  a.setBook('inv-yes', { bids: [level('0.59', '10')], asks: [level('0.61', '10')] });
  a.setBook('inv-no', { bids: [level('0.39', '10')], asks: [level('0.41', '10')] });
  b.setBook('inv2-yes', { bids: [level('0.37', '10')], asks: [level('0.39', '10')] });
  b.setBook('inv2-no', { bids: [level('0.60', '10')], asks: [level('0.62', '10')] });
  // Multi-outcome: one binary Market per candidate on each Venue.
  a.setBook('alice-yes', { bids: [level('0.40', '99')], asks: [level('0.42', '99')] });
  a.setBook('alice-no', { bids: [level('0.58', '99')], asks: [level('0.60', '99')] });
  b.setBook('alice2-yes', { bids: [level('0.38', '99')], asks: [level('0.40', '99')] });
  b.setBook('alice2-no', { bids: [level('0.60', '99')], asks: [level('0.62', '99')] });
  a.setBook('bob-yes', { bids: [level('0.20', '99')], asks: [level('0.22', '99')] });
  a.setBook('bob-no', { bids: [level('0.78', '99')], asks: [level('0.80', '99')] });
  b.setBook('bob2-yes', { bids: [level('0.24', '99')], asks: [level('0.26', '99')] });
  b.setBook('bob2-no', { bids: [level('0.74', '99')], asks: [level('0.76', '99')] });

  t = await createTestApp({ adapters: [a, b], now: () => clock });
  await ingest(a, b);
});
afterAll(() => t.close());

const compare = (id: string, query: { stake?: string; divergenceThreshold?: string } = {}) =>
  t.client.compareEvent({ params: { id }, query });

describe('GET /v1/events/{id}/compare', () => {
  it('ranks Venues by fee-adjusted ask and flags the best one', async () => {
    const x = await eventOf('x');
    await link('x2', x);
    const res = await compare(x);
    const yes = res.outcomes.find((o) => o.label === 'Yes')!;
    const [va, vb] = yes.venues;
    expect(va).toMatchObject({
      venue: { id: 'va' },
      ask: '0.5',
      feePerShare: '0',
      effectiveAsk: '0.5',
    });
    // 0.07 * 0.48 * 0.52 = 0.017472
    expect(vb).toMatchObject({
      venue: { id: 'vb' },
      ask: '0.48',
      feePerShare: '0.017472',
      effectiveAsk: '0.497472',
      redirectUrl: 'https://vb.example/x2',
      stale: false,
    });
    expect(yes.best).toEqual({ marketId: vb!.marketId, outcomeId: vb!.outcomeId });
    expect(yes.venues.every((v) => v.fill === null)).toBe(true);
    // the No side: A (0.52) beats B (0.55 + fee)
    const no = res.outcomes.find((o) => o.label === 'No')!;
    expect(no.best?.marketId).toBe(no.venues[0]!.marketId);
  });

  it('with a stake, walks the book and can pick a different Venue than top-of-book', async () => {
    const x = await eventOf('x');
    const res = await compare(x, { stake: '100' });
    const yes = res.outcomes.find((o) => o.label === 'Yes')!;
    const [va, vb] = yes.venues;
    // A: 50 @ 0.50 = 25, then 75 / 0.60 = 125 @ 0.60 -> 175 shares, no fees, nothing left over.
    expect(va!.fill).toMatchObject({ shares: '175', fees: '0', spent: '100', unspent: '0' });
    expect(Number(va!.fill!.effectivePrice)).toBeCloseTo(100 / 175, 6);
    // B: 10 @ 0.48 (+0.017472 fee) then the 0.70 level (fee 0.0147) -> fewer shares.
    expect(Number(vb!.fill!.shares)).toBeCloseTo(10 + (100 - 4.97472) / 0.7147, 3);
    expect(Number(vb!.fill!.fees)).toBeGreaterThan(0.17472);
    expect(Number(vb!.fill!.spent)).toBeCloseTo(100, 6);
    // top-of-book says B; size-aware says A.
    expect(yes.best).toEqual({ marketId: va!.marketId, outcomeId: va!.outcomeId });
  });

  it('reports a partial fill when the book is too thin', async () => {
    const x = await eventOf('x');
    const res = await compare(x, { stake: '1000' });
    const va = res.outcomes.find((o) => o.label === 'Yes')!.venues[0]!;
    // 50 @ 0.50 + 1000 @ 0.60 absorbs only 625 USD.
    expect(va.fill).toMatchObject({ shares: '1050', spent: '625', unspent: '375' });
  });

  it('flags divergence when mid prices differ by the threshold', async () => {
    const d = await eventOf('div');
    await link('div2', d);
    const res = await compare(d);
    const yes = res.outcomes.find((o) => o.label === 'Yes')!;
    expect(yes.spread).toBe('0.2'); // mids 0.30 vs 0.50
    expect(yes.divergent).toBe(true);
    expect((await compare(d, { divergenceThreshold: '0.25' })).outcomes[0]!.divergent).toBe(false);
    // X's mids are 0.49 vs 0.47: below the default 0.05
    const x = await eventOf('x');
    const xr = await compare(x);
    expect(xr.outcomes.find((o) => o.label === 'Yes')).toMatchObject({
      spread: '0.02',
      divergent: false,
    });
  });

  it('aligns inverse-linked Markets (their YES is the Event NO)', async () => {
    const i = await eventOf('inv');
    await link('inv2', i, { direction: 'inverse' });
    const res = await compare(i);
    const no = res.outcomes.find((o) => o.label === 'No')!;
    expect(no.venues.map((v) => [v.venue.id, v.ask])).toEqual([
      ['va', '0.41'],
      ['vb', '0.39'], // B's own YES book
    ]);
    expect(no.best?.marketId).toBe(no.venues[1]!.marketId);
  });

  it('compares multi-outcome Events per candidate', async () => {
    const e = await eventOf('alice');
    await link('alice2', e, { candidate: 'Alice' });
    await link('bob', e, { candidate: 'Bob' });
    await link('bob2', e, { candidate: 'Bob' });
    const [alice] = await t.db
      .select()
      .from(schema.markets)
      .where(eq(schema.markets.externalId, 'alice'));
    await t.db
      .update(schema.eventMarkets)
      .set({ candidate: 'Alice' })
      .where(eq(schema.eventMarkets.marketId, alice!.id));
    const res = await compare(e);
    expect(res.outcomes.map((o) => o.label)).toEqual(['Alice', 'Not Alice', 'Bob', 'Not Bob']);
    const by = Object.fromEntries(res.outcomes.map((o) => [o.label, o]));
    expect(by['Alice']!.venues).toHaveLength(2);
    expect(by['Alice']!.best?.marketId).toBe(by['Alice']!.venues[1]!.marketId); // B 0.40+fee < A 0.42
    expect(by['Bob']!.best?.marketId).toBe(by['Bob']!.venues[0]!.marketId); // A 0.22 < B 0.26+fee
  });

  it('never picks a stale Venue as best', async () => {
    const x = await eventOf('x');
    clock = new Date(T0.getTime() + 5 * 60_000);
    try {
      const res = await compare(x);
      for (const o of res.outcomes) {
        expect(o.best).toBeNull();
        expect(o.venues.every((v) => v.stale)).toBe(true);
      }
    } finally {
      clock = T0;
    }
  });

  it('validates and 404s', async () => {
    await expect(
      t.client.compareEvent({ params: { id: '00000000-0000-4000-8000-000000000000' }, query: {} }),
    ).rejects.toMatchObject({ status: 404 });
    const x = await eventOf('x');
    await expect(compare(x, { stake: '-5' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('GET /v1/events/{id}/history', () => {
  it('returns one aligned series per Venue on a shared grid', async () => {
    const x = await eventOf('x');
    const at = (min: number) => new Date(T0.getTime() - min * 60_000).toISOString();
    a.setHistory('x-yes', [
      { ts: at(300), price: '0.40' },
      { ts: at(30), price: '0.50' },
    ]);
    b.setHistory('x2-yes', [{ ts: at(10), price: '0.45' }]);
    const res = await t.client.getEventHistory({ params: { id: x }, query: { interval: '1d' } });
    expect(res).toMatchObject({ outcome: 'Yes', outcomes: ['Yes', 'No'], bucketMinutes: 24 });
    expect(res.timestamps).toHaveLength(60);
    expect(res.timestamps.at(-1)).toBe('2026-10-09T12:00:00.000Z');
    expect(res.series.map((s) => s.venueId)).toEqual(['va', 'vb']);
    for (const s of res.series) expect(s.prices).toHaveLength(60);
    const [sa, sb] = res.series;
    expect(sa!.prices.at(-1)).toBe('0.50');
    expect(sa!.prices[0]).toBeNull(); // before the first point
    expect(sa!.prices.at(-2)).toBe('0.50'); // carried forward
    expect(sb!.prices.at(-1)).toBe('0.45');
    expect(sb!.prices.filter((p) => p !== null).length).toBeLessThan(5);
  });

  it('selects an Outcome by label and rejects unknown ones', async () => {
    const x = await eventOf('x');
    const no = await t.client.getEventHistory({ params: { id: x }, query: { outcome: 'no' } });
    expect(no.outcome).toBe('No');
    await expect(
      t.client.getEventHistory({ params: { id: x }, query: { outcome: 'maybe' } }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
