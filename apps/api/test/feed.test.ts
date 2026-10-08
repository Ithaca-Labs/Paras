import { createFakeAdapter, fakeMarket, type FakeAdapter } from '@paras/adapters';
import { enrichEvents, refreshEventSignals, upsertMarkets, upsertVenue } from '@paras/db';
import { buildTaxonomyIndex } from '@paras/domain';
import { createFakeEmbedder } from '@paras/embeddings';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness.js';

const embedder = createFakeEmbedder();
const NOW = new Date('2026-10-09T12:00:00Z');

const mk = (id: string, question: string, volume: string) =>
  fakeMarket(id, { question, volume, liquidity: '3000', endDate: '2027-06-30T00:00:00.000Z' });
const MARKETS = [
  mk('btc1', 'Will Bitcoin reach $150k by year end?', '9000'),
  mk('btc2', 'Will Bitcoin fall below $50k?', '8000'),
  mk('fomc', 'Will the Fed cut rates in December?', '5000'),
  mk('lakers', 'Will the Lakers win the NBA Finals?', '3000'),
  fakeMarket('thin', {
    question: 'Will Bitcoin dominance top 70%?',
    volume: '7000',
    liquidity: '10',
    endDate: '2027-06-30T00:00:00.000Z',
  }),
];

let t: TestApp;
let venue: FakeAdapter;
const id: Record<string, string> = {};

beforeAll(async () => {
  venue = createFakeAdapter({ id: 'fake-venue', markets: MARKETS, now: () => NOW });
  t = await createTestApp({ adapters: [venue], embedder, now: () => NOW });
  const { items } = await venue.listMarkets({ status: 'all' });
  await upsertVenue(t.db, venue);
  await upsertMarkets(t.db, items);
  await enrichEvents(t.db, embedder, await buildTaxonomyIndex(embedder));
  await refreshEventSignals(t.db, NOW);
  const all = await t.client.listEvents({ query: { limit: 100 } });
  for (const e of all.items) id[MARKETS.find((m) => m.question === e.title)!.externalId] = e.id;
});
afterAll(() => t.close());

/** A fresh anonymous visitor: returns request headers carrying their token. */
async function visitor(profile?: object) {
  const res = profile
    ? await t.client.updateProfile({ body: profile })
    : await t.client.recordFeedSignal({ body: { eventId: id.btc1!, kind: 'view' } });
  return {
    headers: { 'x-paras-anon': res.anonToken! },
    // Typed client has no per-call headers; use inject for feed reads.
    feed: async (limit = 20) => {
      const r = await t.app.inject({
        method: 'GET',
        url: `/v1/feed?limit=${limit}`,
        headers: { 'x-paras-anon': res.anonToken! },
      });
      return r.json() as {
        items: { event: { title: string; id: string }; reason: string; score: number }[];
        beginners: { event: { title: string }; reason: string }[];
        personalized: boolean;
        nextCursor: string | null;
      };
    },
    post: (url: string, body: object) =>
      t.app.inject({
        method: 'POST',
        url,
        payload: body,
        headers: { 'x-paras-anon': res.anonToken! },
      }),
  };
}
const short = (f: { items: { event: { title: string } }[] }) =>
  f.items.map((i) => i.event.title.replace(/^Will (the )?/, '').split(' ')[0]);

describe('GET /v1/feed', () => {
  it('no profile: popularity + diversity default, open Events only', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/v1/feed' });
    const feed = r.json();
    expect(feed.personalized).toBe(false);
    // btc1 first; diversity lifts Fed above the second Bitcoin Event.
    expect(feed.items.map((i: { event: { title: string } }) => i.event.title)).toEqual([
      'Will Bitcoin reach $150k by year end?',
      'Will the Fed cut rates in December?',
      'Will Bitcoin fall below $50k?',
      'Will the Lakers win the NBA Finals?',
      'Will Bitcoin dominance top 70%?',
    ]);
    expect(feed.items[0].reason).toBe('Popular on Paras');
    expect(feed.beginners.length).toBeGreaterThan(0);
  });

  it('profile: interest match ranks first with a reason', async () => {
    const v = await visitor({ topics: ['fed-rates'], experience: 'advanced' });
    const feed = await v.feed();
    expect(feed.personalized).toBe(true);
    expect(feed.items[0]!.event.title).toBe('Will the Fed cut rates in December?');
    expect(feed.items[0]!.reason).toBe('Matches your interest in Fed & interest rates');
    expect(feed.beginners).toEqual([]);
  });

  it('beginners get a starter section of liquid, calm Events', async () => {
    const v = await visitor({ topics: ['bitcoin'], experience: 'beginner' });
    const feed = await v.feed();
    expect(feed.beginners.map((b) => b.event.title)).toEqual([
      'Will Bitcoin reach $150k by year end?',
      'Will Bitcoin fall below $50k?',
      'Will the Fed cut rates in December?',
      'Will the Lakers win the NBA Finals?',
    ]);
    expect(feed.beginners[0]!.reason).toMatch(/liquidity/);
    // Thin market is penalised for beginners even though it matches and is popular.
    expect(feed.items.at(-1)!.event.title).toBe('Will Bitcoin dominance top 70%?');
  });

  it('dismiss hides the Event; fewer_like_this pushes down similar ones', async () => {
    const v = await visitor({ topics: ['bitcoin'], experience: 'advanced' });
    const before = await v.feed();
    expect(short(before).slice(0, 2)).toEqual(['Bitcoin', 'Bitcoin']);

    expect(
      (await v.post('/v1/feed/signals', { eventId: id.btc1, kind: 'dismiss' })).statusCode,
    ).toBe(200);
    const dismissed = await v.feed();
    expect(dismissed.items.map((i) => i.event.id)).not.toContain(id.btc1);

    await v.post('/v1/feed/signals', { eventId: id.btc2, kind: 'fewer_like_this' });
    const fewer = await v.feed();
    expect(fewer.items.map((i) => i.event.id)).not.toContain(id.btc2);
    // Remaining Bitcoin Event drops below the unrelated ones it used to beat.
    expect(short(fewer)[0]).not.toBe('Bitcoin');
  });

  it('bets and views boost similar Events', async () => {
    const v = await visitor({ topics: ['fed-rates'], experience: 'advanced' });
    expect((await v.feed()).items[0]!.event.id).toBe(id.fomc);
    await v.post('/v1/feed/signals', { eventId: id.lakers, kind: 'bet' });
    await v.post('/v1/feed/signals', { eventId: id.lakers, kind: 'bet' });
    const after = await v.feed();
    const lakers = after.items.findIndex((i) => i.event.id === id.lakers);
    expect(lakers).toBeGreaterThanOrEqual(0);
    expect(after.items[lakers]!.reason).toMatch(/viewed or bet/);
  });

  it('follows boost related Events with a reason', async () => {
    const v = await visitor({ topics: ['bitcoin'], experience: 'advanced' });
    expect((await v.feed()).items[0]!.event.id).toBe(id.btc1);
    expect((await v.post('/v1/follows', { kind: 'entity', targetId: 'lakers' })).statusCode).toBe(
      200,
    );
    const f = await v.feed();
    expect(f.items[0]!.event.id).toBe(id.lakers);
    expect(f.items[0]!.reason).toBe('Because you follow Los Angeles Lakers');

    await v.post('/v1/follows', { kind: 'event', targetId: id.fomc });
    const f2 = await v.feed();
    expect(f2.items[0]!.event.id).toBe(id.fomc);
    expect(f2.items[0]!.reason).toBe('Because you follow this Event');
  });

  it('follows API validates, lists and unfollows', async () => {
    const v = await visitor();
    expect((await v.post('/v1/follows', { kind: 'topic', targetId: 'lakers' })).statusCode).toBe(
      400,
    );
    expect((await v.post('/v1/follows', { kind: 'event', targetId: 'nope' })).statusCode).toBe(404);
    await v.post('/v1/follows', { kind: 'topic', targetId: 'bitcoin' });
    await v.post('/v1/follows', { kind: 'topic', targetId: 'bitcoin' });
    const h = { 'x-paras-anon': v.headers['x-paras-anon'] };
    const list = await t.app.inject({ method: 'GET', url: '/v1/follows', headers: h });
    expect(list.json().items).toMatchObject([{ kind: 'topic', targetId: 'bitcoin' }]);
    await t.app.inject({
      method: 'DELETE',
      url: '/v1/follows?kind=topic&targetId=bitcoin',
      headers: h,
    });
    expect(
      (await t.app.inject({ method: 'GET', url: '/v1/follows', headers: h })).json().items,
    ).toEqual([]);
  });

  it('anonymous signals and follows move to the User on sign-in', async () => {
    const v = await visitor({ topics: ['bitcoin'], experience: 'advanced' });
    await v.post('/v1/follows', { kind: 'entity', targetId: 'lakers' });
    await v.post('/v1/feed/signals', { eventId: id.btc1, kind: 'dismiss' });
    const email = `feed-${Date.now()}@example.com`;
    await t.app.inject({ method: 'POST', url: '/v1/auth/email/request', payload: { email } });
    const login = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/email/verify',
      payload: { email, code: t.mailer.lastCode(email), session: 'bearer' },
      headers: { 'x-paras-anon': v.headers['x-paras-anon'] },
    });
    const bearer = { authorization: `Bearer ${login.json().token}` };
    const feed = (await t.app.inject({ method: 'GET', url: '/v1/feed', headers: bearer })).json();
    expect(feed.items[0].event.id).toBe(id.lakers);
    expect(feed.items.map((i: { event: { id: string } }) => i.event.id)).not.toContain(id.btc1);
    const follows = await t.app.inject({ method: 'GET', url: '/v1/follows', headers: bearer });
    expect(follows.json().items).toHaveLength(1);
  });
});

describe('Feed weights', () => {
  it('are configurable', async () => {
    const flat = await createTestApp({
      adapters: [venue],
      embedder,
      now: () => NOW,
      feedWeights: { interest: 0, diversity: 0 },
    });
    try {
      const { items } = await venue.listMarkets({ status: 'all' });
      await upsertVenue(flat.db, venue);
      await upsertMarkets(flat.db, items);
      await enrichEvents(flat.db, embedder, await buildTaxonomyIndex(embedder));
      await refreshEventSignals(flat.db, NOW);
      const prof = await flat.client.updateProfile({ body: { topics: ['fed-rates'] } });
      const r = await flat.app.inject({
        method: 'GET',
        url: '/v1/feed',
        headers: { 'x-paras-anon': prof.anonToken! },
      });
      // Interest weight 0: the Fed match no longer wins; trending decides (most traded first).
      expect(r.json().items[0].event.title).toBe('Will Bitcoin reach $150k by year end?');
    } finally {
      await flat.close();
    }
  });
});
