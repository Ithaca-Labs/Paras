import { createFakeAdapter, fakeMarket, type FakeAdapter } from '@paras/adapters';
import { enrichEvents, runMatching, schema, upsertMarkets, upsertVenue } from '@paras/db';
import { buildTaxonomyIndex, type MatchVerifier } from '@paras/domain';
import { DEFAULT_SYNONYMS, createFakeEmbedder } from '@paras/embeddings';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness.js';

const embedder = createFakeEmbedder({
  synonyms: { win: [...DEFAULT_SYNONYMS.win!, 'winner'] },
});
let t: TestApp;
let adapters: FakeAdapter[];
let admin: string;
let user: string;
let n = 0;
// Test-only loose JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const mk = (venueId: string, id: string, question: string, endDate: string, volume = '1000') =>
  fakeMarket(id, { venueId, question, description: '', endDate, volume });

const feeds = (): Record<string, ReturnType<typeof mk>[]> => ({
  polymarket: [
    mk('polymarket', 'fed', 'Will the Fed cut rates in December?', '2026-12-18', '5000'),
    mk('polymarket', 'ecb', 'Will the ECB cut rates in June?', '2026-06-11'),
    mk('polymarket', 'boe', 'Will the BoE cut rates in May?', '2026-05-07'),
    mk('polymarket', 'btc-up', 'Will Bitcoin be above $100k on Dec 31?', '2026-12-31'),
    mk('polymarket', 'nba-26', 'Will the Lakers win the NBA title?', '2027-06-30'),
    mk('polymarket', 'sol-200', 'Will Solana reach $200?', '2026-12-31'),
  ],
  kalshi: [
    mk('kalshi', 'fed-k', 'Will the FOMC lower rates in December?', '2026-12-18', '4000'),
    mk(
      'kalshi',
      'ecb-k',
      'Will the ECB cut rates at the June meeting held in Frankfurt this year?',
      '2026-06-11',
    ),
    mk(
      'kalshi',
      'boe-k',
      'Will the BoE cut rates at the May meeting held in London this year?',
      '2026-05-07',
    ),
    mk('kalshi', 'btc-dn', 'Will Bitcoin be below $100k on Dec 31?', '2026-12-31'),
    mk('kalshi', 'nba-28', 'Will the Lakers win the NBA title?', '2028-06-30'),
    mk('kalshi', 'sol-300', 'Will Solana reach $300?', '2026-12-31'),
    mk('kalshi', 'elec-dave', 'Will Dave win the 2028 election?', '2028-11-07'),
  ],
  limitless: [
    mk('limitless', 'fed-not', 'Will the Fed not cut rates in December?', '2026-12-18', '3000'),
    {
      ...mk('limitless', 'elec', '2028 election winner', '2028-11-07'),
      outcomes: ['Alice', 'Bob', 'Carol'].map((label, index) => ({
        externalId: `elec-${label}`,
        label,
        index,
      })),
    },
  ],
  'polymarket-us': [
    mk('polymarket-us', 'elec-alice', 'Will Alice win the 2028 election?', '2028-11-07'),
  ],
});

async function sync() {
  const taxonomy = await buildTaxonomyIndex(embedder);
  for (const a of adapters) {
    await upsertVenue(t.db, a);
    await upsertMarkets(t.db, (await a.listMarkets({ status: 'all' })).items);
  }
  await enrichEvents(t.db, embedder, taxonomy);
}

/** Forget what was scanned so the next run re-evaluates everything. */
const rescanAll = () => t.db.update(schema.events).set({ matchedHash: null });

async function eventOf(externalId: string) {
  const [row] = await t.db
    .select({ id: schema.eventMarkets.eventId })
    .from(schema.eventMarkets)
    .innerJoin(schema.markets, eq(schema.markets.id, schema.eventMarkets.marketId))
    .where(eq(schema.markets.externalId, externalId));
  return row!.id;
}
const marketId = async (externalId: string) =>
  (await t.db.select().from(schema.markets).where(eq(schema.markets.externalId, externalId)))[0]!
    .id;
const together = async (a: string, b: string) => (await eventOf(a)) === (await eventOf(b));

async function call(
  method: 'GET' | 'POST',
  url: string,
  opts: { body?: unknown; bearer?: string } = {},
) {
  const res = await t.app.inject({
    method,
    url,
    headers: opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {},
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as Json };
}

async function signIn() {
  const email = `match${++n}-${Date.now()}@example.com`;
  await call('POST', '/v1/auth/email/request', { body: { email } });
  const r = await call('POST', '/v1/auth/email/verify', {
    body: { email, code: t.mailer.lastCode(email), session: 'bearer' },
  });
  return r.json.token as string;
}

beforeAll(async () => {
  const f = feeds();
  adapters = Object.entries(f).map(([id, markets]) => createFakeAdapter({ id, name: id, markets }));
  t = await createTestApp({ adapters, embedder });
  await sync();
  await runMatching(t.db);
  admin = await signIn();
  user = await signIn();
  const me = await call('GET', '/v1/me', { bearer: admin });
  await t.db.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.id, me.json.id));
});
afterAll(() => t.close());

describe('automatic matching', () => {
  it('links equivalent Markets across Venues, whatever the Venue', async () => {
    expect(await together('fed', 'fed-k')).toBe(true);
    expect(await together('fed', 'fed-not')).toBe(true);
    expect(await together('elec', 'elec-alice')).toBe(true);
  });

  it('keeps opposite wording, different dates and different strikes apart', async () => {
    expect(await together('btc-up', 'btc-dn')).toBe(false);
    expect(await together('nba-26', 'nba-28')).toBe(false);
    expect(await together('sol-200', 'sol-300')).toBe(false);
    expect(await together('elec', 'elec-dave')).toBe(false);
  });

  it('exposes per-Venue rules, confidence and the low-confidence flag on the Event', async () => {
    const r = await call('GET', `/v1/events/${await eventOf('fed')}`);
    const byExt = Object.fromEntries((r.json.markets as Json[]).map((m) => [m.externalId, m]));
    expect(Object.keys(byExt).sort()).toEqual(['fed', 'fed-k', 'fed-not']);
    expect(byExt['fed-k']).toMatchObject({
      direction: 'same',
      lowConfidence: false,
      matchSource: 'auto',
    });
    expect(Number(byExt['fed-k'].matchConfidence)).toBeGreaterThan(0.93);
    expect(byExt['fed-k'].rules).toBeDefined();
    // negated wording: linked inverse, flagged
    expect(byExt['fed-not']).toMatchObject({ direction: 'inverse', lowConfidence: true });
    expect(r.json.lowConfidence).toBe(true);
    expect(r.json.volume).toBe('12000'); // totals follow the linked Markets
  });

  it('normalizes direction and candidates in comparisons', async () => {
    const fed = await call('GET', `/v1/events/${await eventOf('fed')}/compare`);
    const yes = (fed.json.outcomes as Json[]).find((o) => o.label === 'Yes')!;
    const no = (fed.json.outcomes as Json[]).find((o) => o.label === 'No')!;
    // limitless "not cut" market: its YES is the Event's NO
    const lim = (o: Json) => o.venues.find((v: Json) => v.venue.id === 'limitless').outcomeId;
    const [limNo] = await t.db
      .select()
      .from(schema.outcomes)
      .where(eq(schema.outcomes.externalId, 'fed-not-no'));
    const [limYes] = await t.db
      .select()
      .from(schema.outcomes)
      .where(eq(schema.outcomes.externalId, 'fed-not-yes'));
    expect(lim(yes)).toBe(limNo!.id);
    expect(lim(no)).toBe(limYes!.id);

    const elec = await call('GET', `/v1/events/${await eventOf('elec')}/compare`);
    const alice = (elec.json.outcomes as Json[]).find((o) => o.label === 'Alice')!;
    expect(alice.venues.map((v: Json) => v.venue.id).sort()).toEqual([
      'limitless',
      'polymarket-us',
    ]);
  });

  it('keeps unlinked pairs as separate single-Venue Events', async () => {
    const r = await call('GET', `/v1/events/${await eventOf('btc-up')}`);
    expect(r.json.markets).toHaveLength(1);
    expect(r.json.lowConfidence).toBe(false);
  });
});

describe('verification flag + budget', () => {
  it('is never called by default and lifts review-tier pairs only within budget', async () => {
    expect(await together('ecb', 'ecb-k')).toBe(false); // review tier, no verifier
    let calls = 0;
    const verifier: MatchVerifier = {
      verify: async () => (++calls, 'same'),
    };
    await rescanAll();
    await runMatching(t.db, { verifier, llmBudget: 0 });
    expect(calls).toBe(0);
    await rescanAll();
    await runMatching(t.db, { verifier, llmBudget: 1 });
    expect(calls).toBe(1);
    // one of the two review pairs (ecb/boe) was lifted, the other stayed queued
    const linked = [await together('ecb', 'ecb-k'), await together('boe', 'boe-k')];
    expect(linked.filter(Boolean)).toHaveLength(1);
    // restore: undo the verifier link so the queue tests below are deterministic
    const lifted = linked[0] ? 'ecb-k' : 'boe-k';
    const admins = await call('POST', `/v1/admin/events/${await eventOf(lifted)}/split`, {
      bearer: admin,
      body: { marketId: await marketId(lifted) },
    });
    expect(admins.status).toBe(200);
    await t.db.delete(schema.matchReviews);
    await sync(); // embeds the split-off Event
    await rescanAll();
    await runMatching(t.db);
  });
});

describe('admin review queue', () => {
  it('is guarded', async () => {
    expect((await call('GET', '/v1/admin/match-reviews')).status).toBe(401);
    expect((await call('GET', '/v1/admin/match-reviews', { bearer: user })).status).toBe(403);
  });

  let items: Json[];
  it('lists medium-confidence pairs with rules side by side', async () => {
    const r = await call('GET', '/v1/admin/match-reviews', { bearer: admin });
    expect(r.status).toBe(200);
    items = r.json.items;
    const pairs = items.map((i) => [i.market.question, i.event.markets[0].question]);
    expect(items).toHaveLength(2);
    expect(JSON.stringify(pairs)).toContain('ECB');
    expect(JSON.stringify(pairs)).toContain('BoE');
    for (const i of items) {
      expect(Number(i.confidence)).toBeGreaterThanOrEqual(0.65);
      expect(Number(i.confidence)).toBeLessThan(0.85);
      expect(i.market.rules).toBeDefined();
    }
  });

  it('approve links as an operator override (never low-confidence); reject is remembered', async () => {
    const ecb = items.find((i) => /ECB/.test(i.market.question))!;
    const boe = items.find((i) => /BoE/.test(i.market.question))!;
    const ok = await call('POST', `/v1/admin/match-reviews/${ecb.id}/approve`, { bearer: admin });
    expect(ok.status).toBe(200);
    expect(
      (await call('POST', `/v1/admin/match-reviews/${ecb.id}/approve`, { bearer: admin })).status,
    ).toBe(409);
    expect(
      (await call('POST', `/v1/admin/match-reviews/${boe.id}/reject`, { bearer: admin })).status,
    ).toBe(200);

    const ev = await call('GET', `/v1/events/${ok.json.eventId}`);
    expect(ev.json.markets).toHaveLength(2);
    expect(ev.json.markets.every((m: Json) => !m.lowConfidence)).toBe(true);
    expect(ev.json.markets.map((m: Json) => m.matchSource)).toContain('operator');
    expect(await together('boe', 'boe-k')).toBe(false);
  });

  it('operator merge and split persist across re-sync and re-matching; rejected pairs stay away', async () => {
    const merge = await call('POST', '/v1/admin/events/merge', {
      bearer: admin,
      body: { sourceEventId: await eventOf('sol-300'), targetEventId: await eventOf('sol-200') },
    });
    expect(merge.status).toBe(200);
    const split = await call('POST', `/v1/admin/events/${await eventOf('fed')}/split`, {
      bearer: admin,
      body: { marketId: await marketId('fed-not') },
    });
    expect(split.status).toBe(200);

    await sync(); // re-sync
    await rescanAll();
    const r = await runMatching(t.db);

    expect(await together('sol-200', 'sol-300')).toBe(true); // merge wins over the strike gate
    expect(await together('fed', 'fed-not')).toBe(false); // split wins over auto-link
    expect(await together('fed', 'fed-k')).toBe(true);
    expect(await together('boe', 'boe-k')).toBe(false);
    expect(await together('ecb', 'ecb-k')).toBe(true);
    expect(r.queued).toBe(0); // nothing re-proposed
    const pending = await call('GET', '/v1/admin/match-reviews', { bearer: admin });
    expect(pending.json.items).toHaveLength(0);
  });

  it('admin mutations are guarded', async () => {
    const body = { sourceEventId: await eventOf('btc-up'), targetEventId: await eventOf('btc-dn') };
    expect((await call('POST', '/v1/admin/events/merge', { bearer: user, body })).status).toBe(403);
    expect((await call('POST', '/v1/admin/events/merge', { body })).status).toBe(401);
  });
});
