import { createFakeAdapter, fakeMarket } from '@paras/adapters';
import { createDb, schema, upsertMarkets, upsertVenue, type DbHandle } from '@paras/db';
import { MemoryMailer } from '@paras/shared';
import { createTestDatabase, type TestDatabase } from '@paras/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAlertScanJob, createDigestJob } from '../src/jobs/notifications.js';

const NOW = new Date('2026-10-09T12:00:00Z');
const DEFAULTS = { moveThreshold: 0.1, closingWithinHours: 24 };

let testDb: TestDatabase;
let handle: DbHandle;
let db: DbHandle['db'];
const mailer = new MemoryMailer();
const ev: Record<string, string> = {};
const user: Record<string, string> = {};

const setEvent = (name: string, set: Partial<typeof schema.events.$inferInsert>) =>
  db.update(schema.events).set(set).where(eq(schema.events.id, ev[name]!));
const inbox = (ownerKey: string) =>
  db.select().from(schema.notifications).where(eq(schema.notifications.ownerKey, ownerKey));

beforeAll(async () => {
  testDb = await createTestDatabase();
  handle = createDb(testDb.url);
  db = handle.db;
  const venue = createFakeAdapter({ id: 'fake-venue' });
  await upsertVenue(db, venue);
  await upsertMarkets(db, [
    fakeMarket('calm', { endDate: '2027-01-01T00:00:00.000Z' }),
    fakeMarket('mover', { endDate: '2027-01-01T00:00:00.000Z' }),
    fakeMarket('closing', { endDate: '2026-10-10T00:00:00.000Z' }),
    fakeMarket('btc', { question: 'Will BTC hit 200k?' }),
    fakeMarket('lakers', { question: 'Will Lakers win?' }),
  ]);
  for (const e of await db.select().from(schema.events)) {
    ev[e.title.match(/Will (\w+)/)![1]!.toLowerCase()] = e.id;
  }
  for (const name of ['alice', 'bob', 'carol']) {
    const [u] = await db.insert(schema.users).values({}).returning();
    user[name] = `u:${u!.id}`;
    await db.insert(schema.emailIdentities).values({ userId: u!.id, email: `${name}@example.com` });
  }
});
afterAll(async () => {
  await handle.close();
  await testDb.drop();
});

describe('notify.scan-alerts', () => {
  const run = () => createAlertScanJob({ db, mailer, now: () => NOW }).handler(DEFAULTS);

  it('alerts on sharp moves and nearing resolution of followed Events only', async () => {
    await setEvent('mover', { move24h: '0.15' });
    await setEvent('calm', { move24h: '0.02' });
    await db.insert(schema.follows).values([
      { ownerKey: user.alice!, kind: 'event', targetId: ev.mover! },
      { ownerKey: user.alice!, kind: 'event', targetId: ev.calm! },
      { ownerKey: user.alice!, kind: 'event', targetId: ev.closing! },
      { ownerKey: 'a:anonhash', kind: 'event', targetId: ev.mover! },
    ]);
    await run();

    const alice = await inbox(user.alice!);
    expect(alice.map((n) => n.kind).sort()).toEqual(['closing_soon', 'price_move']);
    expect(alice.find((n) => n.kind === 'price_move')).toMatchObject({
      eventId: ev.mover,
      inApp: true,
    });
    expect(mailer.outbox.map((m) => m.to)).toEqual(['alice@example.com', 'alice@example.com']);
    // Anonymous visitors: in-app only, no email.
    expect(await inbox('a:anonhash')).toHaveLength(1);
    expect(mailer.outbox).toHaveLength(2);
  });

  it('does not send the same alert twice', async () => {
    await run();
    await run();
    expect(await inbox(user.alice!)).toHaveLength(2);
    expect(mailer.outbox).toHaveLength(2);
  });

  it('thresholds are configurable', async () => {
    await db
      .insert(schema.follows)
      .values({ ownerKey: user.bob!, kind: 'event', targetId: ev.calm! });
    await createAlertScanJob({ db, mailer, now: () => NOW }).handler({
      moveThreshold: 0.5,
      closingWithinHours: 1,
    });
    expect(await inbox(user.bob!)).toHaveLength(0);
    await createAlertScanJob({ db, mailer, now: () => NOW }).handler({
      moveThreshold: 0.01,
      closingWithinHours: 1,
    });
    expect(await inbox(user.bob!)).toMatchObject([{ kind: 'price_move', eventId: ev.calm }]);
  });

  it('respects channel preferences', async () => {
    await db.insert(schema.notificationPrefs).values({
      ownerKey: user.carol!,
      email: false,
      inApp: true,
      frequency: 'instant',
    });
    await db
      .insert(schema.follows)
      .values({ ownerKey: user.carol!, kind: 'event', targetId: ev.mover! });
    const before = mailer.outbox.length;
    await run();
    expect(await inbox(user.carol!)).toHaveLength(1);
    expect(mailer.outbox).toHaveLength(before);
  });

  it('frequency=off mutes; daily throttles to one alert per day', async () => {
    const [dave] = await db.insert(schema.users).values({}).returning();
    const key = `u:${dave!.id}`;
    await db.insert(schema.follows).values([
      { ownerKey: key, kind: 'event', targetId: ev.mover! },
      { ownerKey: key, kind: 'event', targetId: ev.closing! },
    ]);
    await db
      .insert(schema.notificationPrefs)
      .values({ ownerKey: key, email: true, inApp: true, frequency: 'off' });
    await run();
    expect(await inbox(key)).toHaveLength(0);

    await db
      .update(schema.notificationPrefs)
      .set({ frequency: 'daily' })
      .where(eq(schema.notificationPrefs.ownerKey, key));
    await run();
    expect(await inbox(key)).toHaveLength(1); // second alert held back
  });
});

describe('notify.weekly-digest', () => {
  it('lists new Events matching the Interest Profile, once per week', async () => {
    await db.insert(schema.eventTags).values([
      { eventId: ev.btc!, tagId: 'crypto', kind: 'category', score: '1', source: 'keyword' },
      { eventId: ev.lakers!, tagId: 'sports', kind: 'category', score: '1', source: 'keyword' },
    ]);
    await db.update(schema.events).set({ createdAt: new Date('2026-10-08T00:00:00Z') });
    await db.insert(schema.interestProfiles).values({
      userId: user.alice!.slice(2),
      status: 'completed',
      categories: ['crypto'],
    });
    const mails = mailer.outbox.length;
    const job = createDigestJob({ db, mailer, now: () => NOW });
    await job.handler({ limit: 5 });
    await job.handler({ limit: 5 });

    const digests = (await inbox(user.alice!)).filter((n) => n.kind === 'digest');
    expect(digests).toHaveLength(1);
    expect(digests[0]!.body).toContain('Will BTC hit 200k?');
    expect(digests[0]!.body).not.toContain('Lakers');
    expect(mailer.outbox).toHaveLength(mails + 1);
  });
});
