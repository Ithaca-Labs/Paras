import { createFakeAdapter, fakeMarket } from '@paras/adapters';
import { notify, schema, upsertMarkets, upsertVenue } from '@paras/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonKey } from '../src/feed/store.js';
import { createTestApp, type TestApp } from './harness.js';

let t: TestApp;
let eventId: string;

beforeAll(async () => {
  const venue = createFakeAdapter({ id: 'fake-venue', markets: [fakeMarket('m1')] });
  t = await createTestApp({ adapters: [venue] });
  await upsertVenue(t.db, venue);
  await upsertMarkets(t.db, (await venue.listMarkets({ status: 'all' })).items);
  eventId = (await t.client.listEvents({ query: { limit: 1 } })).items[0]!.id;
});
afterAll(() => t.close());

/** Anonymous visitor (token minted by a follow). */
async function visitor() {
  const { anonToken } = await t.client.addFollow({ body: { kind: 'event', targetId: eventId } });
  const headers = { 'x-paras-anon': anonToken! };
  const call = async (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    (await t.app.inject({ method, url, payload, headers })).json();
  return { key: anonKey(anonToken!), headers, call };
}
const raise = (ownerKey: string, n: number, kind: 'digest' | 'intent_update' = 'intent_update') =>
  notify(t.db, t.mailer, {
    ownerKey,
    kind,
    dedupeKey: `k${n}`,
    title: `T${n}`,
    body: 'b',
    eventId,
  });

describe('notifications API', () => {
  it('signed-out callers see nothing and get default preferences', async () => {
    expect(await t.client.listNotifications({ query: {} })).toEqual({
      items: [],
      unread: 0,
      nextCursor: null,
    });
    expect(await t.client.getNotificationPrefs()).toEqual({
      email: true,
      inApp: true,
      frequency: 'instant',
    });
    const res = await t.app.inject({
      method: 'PUT',
      url: '/v1/notifications/preferences',
      payload: { email: false, inApp: true, frequency: 'daily' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('lists newest first with paging, unread count and mark-read', async () => {
    const v = await visitor();
    for (const n of [1, 2, 3]) await raise(v.key, n);
    const p1 = await v.call('GET', '/v1/notifications?limit=2');
    expect(p1.items.map((i: { title: string }) => i.title)).toEqual(['T3', 'T2']);
    expect(p1.unread).toBe(3);
    const p2 = await v.call('GET', `/v1/notifications?limit=2&cursor=${p1.nextCursor}`);
    expect(p2.items.map((i: { title: string }) => i.title)).toEqual(['T1']);
    expect(p2.nextCursor).toBeNull();

    expect(await v.call('POST', '/v1/notifications/read', { ids: [p1.items[0].id] })).toEqual({
      updated: 1,
    });
    const unread = await v.call('GET', '/v1/notifications?unreadOnly=true');
    expect(unread.items).toHaveLength(2);
    expect(unread.unread).toBe(2);
    expect(await v.call('POST', '/v1/notifications/read', {})).toEqual({ updated: 2 });
    expect((await v.call('GET', '/v1/notifications')).unread).toBe(0);
  });

  it('preferences gate delivery; callers cannot read each other', async () => {
    const a = await visitor();
    const b = await visitor();
    expect(
      await a.call('PUT', '/v1/notifications/preferences', {
        email: true,
        inApp: false,
        frequency: 'instant',
      }),
    ).toMatchObject({ inApp: false });
    expect(await a.call('GET', '/v1/notifications/preferences')).toMatchObject({ inApp: false });
    await raise(a.key, 1);
    await raise(b.key, 1);
    expect((await a.call('GET', '/v1/notifications')).items).toHaveLength(0);
    expect((await b.call('GET', '/v1/notifications')).items).toHaveLength(1);

    await a.call('PUT', '/v1/notifications/preferences', {
      email: true,
      inApp: true,
      frequency: 'off',
    });
    expect(await raise(a.key, 2, 'digest')).toBe(false); // muted
    expect(await raise(a.key, 3)).toBe(true); // Intent updates still arrive
  });

  it('emails Users and moves anonymous notifications on sign-in', async () => {
    const v = await visitor();
    await raise(v.key, 1);
    const email = `notif-${Date.now()}@example.com`;
    await t.app.inject({ method: 'POST', url: '/v1/auth/email/request', payload: { email } });
    const login = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/email/verify',
      payload: { email, code: t.mailer.lastCode(email), session: 'bearer' },
      headers: v.headers,
    });
    const bearer = { authorization: `Bearer ${login.json().token}` };
    const list = (
      await t.app.inject({ method: 'GET', url: '/v1/notifications', headers: bearer })
    ).json();
    expect(list.items.map((i: { title: string }) => i.title)).toEqual(['T1']);

    const userId = (await t.db.select().from(schema.emailIdentities)).find(
      (e) => e.email === email,
    )!.userId;
    const before = t.mailer.outbox.length;
    await raise(`u:${userId}`, 2);
    expect(t.mailer.outbox.at(-1)).toMatchObject({ to: email, subject: 'T2' });
    expect(t.mailer.outbox).toHaveLength(before + 1);
  });
});
