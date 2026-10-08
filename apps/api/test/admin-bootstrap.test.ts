import { createFakeAdapter, fakeMarket } from '@paras/adapters';
import { enrichEvents, schema, upsertMarkets, upsertVenue } from '@paras/db';
import { buildTaxonomyIndex } from '@paras/domain';
import { createFakeEmbedder } from '@paras/embeddings';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness.js';

const embedder = createFakeEmbedder();
let t: TestApp;
const adapter = createFakeAdapter({
  id: 'polymarket',
  name: 'polymarket',
  markets: [fakeMarket('m1', { venueId: 'polymarket', question: 'Will X happen?' })],
});

async function signIn(email: string) {
  await t.app.inject({ method: 'POST', url: '/v1/auth/email/request', payload: { email } });
  const r = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/email/verify',
    payload: { email, code: t.mailer.lastCode(email), session: 'bearer' },
  });
  return r.json().token as string;
}
const patch = (token: string, id: string, payload: object) =>
  t.app.inject({
    method: 'PATCH',
    url: `/v1/admin/events/${id}`,
    headers: { authorization: `Bearer ${token}` },
    payload,
  });

beforeAll(async () => {
  t = await createTestApp({ auth: { adminEmails: ['boss@example.com'] }, adapters: [adapter] });
});
afterAll(() => t.close());

describe('admin bootstrap + relabel', () => {
  it('promotes listed email on sign-in; unlisted stays user', async () => {
    const admin = await signIn('boss@example.com');
    const user = await signIn('joe@example.com');
    const [event] = await t.db
      .insert(schema.events)
      .values({ title: 't', status: 'open' })
      .returning();
    expect((await patch(admin, event!.id, { title: 'T2' })).statusCode).toBe(200);
    expect((await patch(user, event!.id, { title: 'T3' })).statusCode).toBe(403);
  });

  it('relabel survives re-sync and re-enrichment', async () => {
    const admin = await signIn('boss@example.com');
    await upsertVenue(t.db, adapter);
    const sync = async () => {
      await upsertMarkets(t.db, (await adapter.listMarkets({ status: 'all' })).items);
      await enrichEvents(t.db, embedder, await buildTaxonomyIndex(embedder));
    };
    await sync();
    const [m] = await t.db.select().from(schema.markets).where(eq(schema.markets.externalId, 'm1'));
    const [link] = await t.db
      .select()
      .from(schema.eventMarkets)
      .where(eq(schema.eventMarkets.marketId, m!.id));
    const id = link!.eventId;
    const res = await patch(admin, id, { title: 'Custom title', category: 'custom-cat' });
    expect(res.json()).toMatchObject({ title: 'Custom title', category: 'custom-cat' });
    await t.db.update(schema.events).set({ embeddedHash: null }).where(eq(schema.events.id, id));
    await sync();
    const [e] = await t.db.select().from(schema.events).where(eq(schema.events.id, id));
    expect(e).toMatchObject({ title: 'Custom title', category: 'custom-cat' });
    expect((await patch(admin, id, {})).statusCode).toBe(400);
  });
});
