import { createFakeAdapter, createKalshiAdapter, fakeMarket } from '@paras/adapters';
import { enrichEvents, runMatching, schema, upsertMarkets, upsertVenue } from '@paras/db';
import { buildTaxonomyIndex } from '@paras/domain';
import { createFakeEmbedder } from '@paras/embeddings';
import { createFixtureFetch } from '@paras/testkit';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness.js';

const NATO = 'Who will be the next Secretary General of NATO?';
const kalshi = createKalshiAdapter({
  // Recorded Kalshi responses; never hits the network.
  fetch: createFixtureFetch({
    dir: new URL('../../../packages/adapters/test/fixtures/kalshi/', import.meta.url),
  }),
  now: () => new Date('2026-10-09T12:00:00Z'),
});
const embedder = createFakeEmbedder();

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ adapters: [kalshi], embedder });
  await upsertVenue(t.db, kalshi);
});
afterAll(() => t.close());

const natoEvents = () =>
  t.db
    .selectDistinct({ id: schema.eventMarkets.eventId })
    .from(schema.eventMarkets)
    .innerJoin(schema.markets, eq(schema.markets.id, schema.eventMarkets.marketId))
    .where(sql`${schema.markets.externalId} like 'KXNEXTNATOSECGEN-99%'`);

describe('Kalshi event grouping', () => {
  it('folds legacy single-Market Events into one Event, keeping Magic Links and follows', async () => {
    const { items } = await kalshi.listMarkets({ limit: 5 });
    // Before grouping shipped: every Kalshi Market was its own Event.
    await upsertMarkets(
      t.db,
      items.map(({ group: _g, ...m }) => m),
    );
    expect((await natoEvents()).length).toBeGreaterThan(1);
    const [link] = await t.db
      .select({ eventId: schema.eventMarkets.eventId })
      .from(schema.eventMarkets)
      .innerJoin(schema.markets, eq(schema.markets.id, schema.eventMarkets.marketId))
      .where(eq(schema.markets.externalId, 'KXNEXTNATOSECGEN-99-KKAL'));
    await t.db.insert(schema.magicLinks).values({
      eventId: link!.eventId,
      source: 'web',
      kid: 'k',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await t.db
      .insert(schema.follows)
      .values({ ownerKey: 'u', kind: 'event', targetId: link!.eventId });

    // Next sync, with grouping (twice: idempotent).
    await upsertMarkets(t.db, items);
    await upsertMarkets(t.db, items);

    const after = await natoEvents();
    expect(after).toHaveLength(1);
    const natoMarkets = items.filter((m) => m.group?.key === 'KXNEXTNATOSECGEN-99');
    const [event] = await t.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, after[0]!.id));
    expect(event).toMatchObject({ title: NATO, status: 'open' });
    expect(Number(event!.volume)).toBe(natoMarkets.reduce((a, m) => a + Number(m.volume), 0));
    const members = await t.db
      .select()
      .from(schema.eventMarkets)
      .where(eq(schema.eventMarkets.eventId, event!.id));
    expect(members.map((m) => m.candidate).sort()).toEqual(
      natoMarkets.map((m) => m.group!.candidate).sort(),
    );
    // No orphan Events; references survive.
    const orphans = await t.db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(sql`not exists (select 1 from event_markets where event_id = events.id)`);
    expect(orphans).toEqual([]);
    expect((await t.db.select().from(schema.magicLinks))[0]!.eventId).toBe(event!.id);
    expect((await t.db.select().from(schema.follows))[0]!.targetId).toBe(event!.id);

    // The API serves one Kalshi Event with a Market per candidate.
    const res = await t.client.listEvents({ query: { venue: 'kalshi' } });
    const grouped = res.items.find((e) => e.id === event!.id)!;
    expect(grouped.title).toBe(NATO);
    expect(grouped.markets).toHaveLength(natoMarkets.length);
  });

  it('still proposes a Polymarket Market for the Kalshi group as that candidate', async () => {
    const poly = createFakeAdapter({
      id: 'polymarket',
      markets: [
        fakeMarket('kallas', {
          venueId: 'polymarket',
          question: 'Who will be the next Secretary General of NATO: Kaja Kallas',
          description:
            'If Kaja Kallas formally holds the position of Secretary General of NATO, then the market resolves to Yes.',
          endDate: null,
          volume: '9000',
        }),
      ],
    });
    await upsertVenue(t.db, poly);
    await upsertMarkets(t.db, (await poly.listMarkets({ status: 'all' })).items);
    await enrichEvents(t.db, embedder, await buildTaxonomyIndex(embedder));
    await runMatching(t.db);

    // Group titles dilute the Event embedding, so the pair lands in the review queue (not auto),
    // proposed against the group Event with the candidate named in the question.
    const [group] = await natoEvents();
    const [review] = await t.db
      .select({
        eventId: schema.matchReviews.eventId,
        candidate: schema.matchReviews.candidate,
        externalId: schema.markets.externalId,
      })
      .from(schema.matchReviews)
      .innerJoin(schema.markets, eq(schema.markets.id, schema.matchReviews.marketId));
    expect(review).toEqual({ eventId: group!.id, candidate: 'Kaja Kallas', externalId: 'kallas' });
  });
});
