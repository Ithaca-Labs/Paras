import { schema } from '@paras/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './world.js';

describe('ops pause (#23)', () => {
  let t: Harness;
  beforeEach(async () => {
    t = await createHarness();
  });
  afterEach(() => t.close());

  const status = async (id: string) =>
    (await t.db.select().from(schema.intents).where(eq(schema.intents.id, id)))[0]!.status;
  const pause = (scope: string) =>
    t.db.insert(schema.executorPauses).values({ scope, reason: 'test' });

  it('global pause holds a signed Intent (no dispatch); unpausing lets it run', async () => {
    await pause('global');
    const id = await t.newIntent();
    expect(await t.engine().run(id)).toBe('wait');
    expect(await status(id)).toBe('signed');
    expect(t.world.count.dispatch).toBe(0);
    await t.db.delete(schema.executorPauses);
    expect(await t.engine().run(id)).toBe('done');
    expect(await status(id)).toBe('filled');
  });

  it('per-Venue pause holds that Venue only', async () => {
    await pause('kalshi');
    const id = await t.newIntent(); // polymarket
    expect(await t.engine().run(id)).toBe('done');
    await t.db.delete(schema.executorPauses);
    await pause('polymarket');
    const held = await t.newIntent();
    expect(await t.engine().run(held)).toBe('wait');
    expect(await status(held)).toBe('signed');
  });

  it('in-flight Intents keep settling while paused', async () => {
    const id = await t.newIntent();
    await t.engine().step(id); // signed -> dispatched
    expect(await status(id)).toBe('dispatched');
    await pause('global');
    expect(await t.engine().run(id)).toBe('done');
    expect(await status(id)).toBe('filled');
  });

  it('a held Intent still expires (refund) while paused', async () => {
    await pause('global');
    const id = await t.newIntent({ expiresInMs: 60_000 });
    expect(await t.engine().run(id)).toBe('wait');
    t.clock.now = new Date(t.clock.now.getTime() + 61_000);
    expect(await t.engine().run(id)).toBe('done');
    expect(await status(id)).toBe('expired');
  });
});
