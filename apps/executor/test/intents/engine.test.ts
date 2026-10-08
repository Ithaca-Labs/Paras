import { schema } from '@paras/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './world.js';

describe('Intent engine (Seam 4: Intent -> route -> bridge -> order -> fill)', () => {
  let t: Harness;
  beforeEach(async () => {
    t = await createHarness();
  });
  afterEach(() => t.close());

  const row = async (id: string) =>
    (await t.db.select().from(schema.intents).where(eq(schema.intents.id, id)))[0]!;
  const timeline = async (id: string) =>
    (await t.db.select().from(schema.intentEvents).where(eq(schema.intentEvents.intentRowId, id)))
      .sort((a, b) => a.id - b.id)
      .map((e) => e.status);
  const notes = async () => t.db.select().from(schema.notifications);

  it('runs the full lifecycle: dispatch, attest, mint, swap+wrap, order, fill', async () => {
    const id = await t.newIntent({ amount: 10 });
    expect((await row(id)).status).toBe('signed');
    expect(await t.engine().run(id)).toBe('done');

    const r = await row(id);
    expect(r.status).toBe('filled');
    expect(await timeline(id)).toEqual([
      'signed',
      'dispatched',
      'bridging',
      'bridged',
      'ordering',
      'filled',
    ]);
    const w = t.world;
    expect(w.count).toMatchObject({ dispatch: 1, mint: 1, batches: 1, orders: 1, settles: 0 });
    // One policy-checked batch: approve, swap native->USDC.e, approve, wrap, approve exchange.
    expect(w.submitted[0]!.calls).toHaveLength(5);
    expect(w.pusd).toBe(0n); // all of the 9.95 pUSD (minOut at 50 bps slippage) was spent
    expect(Number(r.ctx.filledShares)).toBeCloseTo(18.09, 2); // 9.95 pUSD at the 0.55 limit
    const n = await notes();
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ kind: 'intent_update', ownerKey: `u:${t.userId}` });
  });

  it('rejects an order when nothing is within max price: no order, funds returned, Intent failed', async () => {
    t.world.asks = [{ price: '0.80', size: '10000' }];
    const id = await t.newIntent({ amount: 10, maxPrice: '0.55' });
    expect(await t.engine().run(id)).toBe('done');
    const r = await row(id);
    expect(r.status).toBe('failed');
    expect(r.ctx.reason).toMatch(/no liquidity within max price/);
    expect(t.world.count.orders).toBe(0);
    expect(t.world.count.settles).toBe(1); // returned to the Vault
    expect(t.world.count.closes).toBe(1); // nothing bought: slippage remainder written off
    expect(await timeline(id)).toContain('returning');
    expect(t.world.pusd).toBe(0n);
  });

  it('partial fill with remainder=return: keeps the shares, returns the rest', async () => {
    t.world.clobMode = 'partial';
    const id = await t.newIntent({ amount: 10 });
    expect(await t.engine().run(id)).toBe('done');
    const r = await row(id);
    expect(r.status).toBe('partially_filled');
    expect(Number(r.ctx.filledShares)).toBeCloseTo(9.045, 2); // half the stake at the 0.55 limit
    expect(t.world.count.settles).toBe(1);
    expect(t.world.count.closes).toBe(0); // the position's in-flight claim stays
    expect(await timeline(id)).toEqual([
      'signed',
      'dispatched',
      'bridging',
      'bridged',
      'ordering',
      'returning',
      'partially_filled',
    ]);
    expect((await notes())[0]!.title).toMatch(/partially filled/);
  });

  it('remainder=rest: rests a GTC order, and at expiry cancels it and returns the rest', async () => {
    t.world.clobMode = 'rest';
    const id = await t.newIntent({ amount: 10, remainder: 'rest', expiresInMs: 600_000 });
    expect(await t.engine().run(id)).toBe('wait'); // order resting
    expect(t.world.count.orders).toBe(1);
    t.clock.now = new Date(t.clock.now.getTime() + 601_000);
    expect(await t.engine().run(id)).toBe('done');
    expect(t.world.count.cancels).toBe(1);
    expect((await row(id)).status).toBe('partially_filled');
    expect(t.world.count.settles).toBe(1);
  });

  it('expiry refund: an undispatched Intent past expiry is released to idle', async () => {
    const id = await t.newIntent({ expiresInMs: 60_000 });
    t.clock.now = new Date(t.clock.now.getTime() + 61_000);
    expect(await t.engine().run(id)).toBe('done');
    expect((await row(id)).status).toBe('expired');
    expect(t.world.count).toMatchObject({ expires: 1, dispatch: 0 });
  });

  it('fails closed when the geoblock check fails: no dispatch', async () => {
    t.world.geoblocked = true;
    const id = await t.newIntent();
    expect(await t.engine().run(id)).toBe('wait');
    expect(t.world.count.dispatch).toBe(0);
    t.world.geoblocked = false;
    expect(await t.engine().run(id)).toBe('done');
  });

  it('applies Vault cancel events before dispatch', async () => {
    const id = await t.newIntent();
    const r = await row(id);
    await t.engine().onVaultEvent({
      kind: 'cancelled',
      user: t.userAddress,
      id: r.intentId as `0x${string}`,
      block: 2n,
    });
    expect((await row(id)).status).toBe('cancelled');
    expect(await t.engine().step(id)).toBe('done');
  });

  it('ignores a submitted event whose details hash differs from the preview', async () => {
    const id = await t.newIntent();
    await t.db.update(schema.intents).set({ status: 'previewed' }).where(eq(schema.intents.id, id));
    const r = await row(id);
    await t.engine().onVaultEvent({
      kind: 'submitted',
      user: t.userAddress,
      id: r.intentId as `0x${string}`,
      amount: BigInt(r.amountUsdc),
      expiry: BigInt(Math.floor(r.expiry.getTime() / 1000)),
      detailsHash: `0x${'00'.repeat(32)}`,
      block: 3n,
    });
    expect((await row(id)).status).toBe('previewed');
  });

  describe('idempotent under injected restarts', () => {
    // The effect happens, the process dies before recording it; a fresh engine must not repeat it.
    it.each(['after-dispatch', 'after-mint', 'after-batch', 'after-order'])(
      'crash %s',
      async (point) => {
        const id = await t.newIntent({ amount: 10 });
        t.world.crashPoint = point;
        await expect(t.engine().run(id)).rejects.toThrow(/injected crash/);
        expect(await t.engine().run(id)).toBe('done'); // new engine = restarted process
        expect((await row(id)).status).toBe('filled');
        expect(t.world.count).toMatchObject({ dispatch: 1, mint: 1, batches: 1, orders: 1 });
        expect(await notes()).toHaveLength(1);
      },
    );

    it('crash after Vault.settle on the return leg', async () => {
      t.world.clobMode = 'partial';
      const id = await t.newIntent({ amount: 10 });
      t.world.crashPoint = 'after-settle';
      await expect(t.engine().run(id)).rejects.toThrow(/injected crash/);
      expect(await t.engine().run(id)).toBe('done');
      expect((await row(id)).status).toBe('partially_filled');
      expect(t.world.count.settles).toBe(1);
      expect(await notes()).toHaveLength(1);
    });

    it('two engines stepping the same Intent concurrently still finish once', async () => {
      const id = await t.newIntent({ amount: 10 });
      const results = await Promise.allSettled([t.engine().run(id), t.engine().run(id)]);
      void results;
      await t.engine().run(id);
      expect((await row(id)).status).toBe('filled');
      expect(await notes()).toHaveLength(1);
    });
  });
});
