import { schema } from '@paras/db';
import { eq } from 'drizzle-orm';
import { toFunctionSelector, zeroHash } from 'viem';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanResolved } from '../../src/exits/engine.js';
import { POLYGON } from '../../src/wallet/constants.js';
import { createHarness, TOKEN, type Harness } from './world.js';

const REDEEM_SELECTOR = toFunctionSelector('redeemPositions(address,bytes32,bytes32,uint256[])');

describe('Exits, redemption and the return bridge (Seam 4)', () => {
  let t: Harness;
  let intentRow: string;
  beforeEach(async () => {
    t = await createHarness();
    intentRow = await t.newIntent({ amount: 10 });
    await t.engine().run(intentRow); // full fill: a position now exists
    t.world.count.settles = 0;
    t.world.settledFor.length = 0;
  });
  afterEach(() => t.close());

  const position = async () =>
    (
      await t.db.select().from(schema.positions).where(eq(schema.positions.intentRowId, intentRow))
    )[0]!;
  const exit = async (id: string) =>
    (await t.db.select().from(schema.exits).where(eq(schema.exits.id, id)))[0]!;
  const notes = async () => t.db.select().from(schema.notifications);
  const sell = async (
    o: { returnTo?: 'vault' | 'polygon'; shares?: bigint; minPrice?: string } = {},
  ) => {
    const p = await position();
    const [e] = await t.db
      .insert(schema.exits)
      .values({
        positionId: p.id,
        userId: t.userId,
        kind: 'sell',
        shares: (o.shares ?? BigInt(p.shares)).toString(),
        minPrice: o.minPrice ?? '0.60',
        returnTo: o.returnTo ?? 'vault',
      })
      .returning();
    return e!.id;
  };
  const vaultIntentId = async () =>
    (await t.db.select().from(schema.intents).where(eq(schema.intents.id, intentRow)))[0]!.intentId;
  const resolve = async (numerators: bigint[]) => {
    t.world.resolutions.set(t.market.conditionId, { denominator: 1n, numerators });
    await t.db
      .update(schema.markets)
      .set({ status: 'resolved' })
      .where(eq(schema.markets.id, t.market.id));
  };

  it('buy creates a position with the fill', async () => {
    const p = await position();
    expect(p).toMatchObject({ status: 'open', tokenId: TOKEN, outcomeIndex: 0, returnTo: 'vault' });
    expect(Number(p.shares)).toBeGreaterThan(18_000_000);
    expect(p.shares).toBe(p.sharesBought);
    expect(p.costUsdc).toBe('9950000');
  });

  it('sell: approve, order, bridge proceeds back, settle the claim, close the position', async () => {
    const id = await sell({ minPrice: '0.60' });
    expect(await t.exits().run(id)).toBe('done');
    const e = await exit(id);
    expect(e.status).toBe('done');
    const w = t.world;
    expect(w.count).toMatchObject({ approvals: 1, sells: 1, settles: 1, closes: 1 });
    expect(w.settledFor).toEqual([await vaultIntentId()]); // reduces the buy's in-flight claim
    expect(w.pusd).toBe(0n); // swept
    expect(e.ctx.settleTx).toBeTruthy();
    expect(e.ctx.returnTx).toBeTruthy();
    const p = await position();
    expect(p).toMatchObject({ status: 'closed', shares: '0' });
    expect(Number(e.ctx.proceedsUsdc)).toBeGreaterThan(10_000_000); // ~18.09 shares at 0.60
    expect((await notes()).at(-1)!.title).toBe('Position sold');
  });

  it('partial sell keeps the position open and the Vault claim alive', async () => {
    t.world.sellMode = 'partial';
    const before = BigInt((await position()).shares);
    const id = await sell();
    expect(await t.exits().run(id)).toBe('done');
    const p = await position();
    expect(p.status).toBe('open');
    expect(BigInt(p.shares)).toBe(before - BigInt((await exit(id)).ctx.soldShares!));
    expect(t.world.count).toMatchObject({ settles: 1, closes: 0 });
  });

  it('returnTo polygon: proceeds stay in the wallet, the Vault claim is written off', async () => {
    const id = await sell({ returnTo: 'polygon' });
    expect(await t.exits().run(id)).toBe('done');
    expect(t.world.count).toMatchObject({ settles: 0, closes: 1 });
    expect(t.world.pusd).toBeGreaterThan(0n);
    expect((await position()).status).toBe('closed');
  });

  it('a sell nothing fills for fails and keeps the position', async () => {
    t.world.sellMode = 'none';
    const id = await sell();
    expect(await t.exits().run(id)).toBe('done');
    expect((await exit(id)).status).toBe('failed');
    expect((await exit(id)).ctx.reason).toMatch(/nothing filled/);
    expect((await position()).status).toBe('open');
    expect(t.world.count).toMatchObject({ settles: 0, closes: 0 });
  });

  it('refuses to sell more than the position holds, and waits on the geoblock', async () => {
    const p = await position();
    const big = await sell({ shares: BigInt(p.shares) + 1n });
    expect(await t.exits().run(big)).toBe('done');
    expect((await exit(big)).status).toBe('failed');
    t.world.geoblocked = true;
    const id = await sell();
    expect(await t.exits().run(id)).toBe('wait');
    expect(t.world.count.sells).toBe(0);
  });

  describe('redemption on resolution', () => {
    it('does nothing until the condition is resolved on-chain', async () => {
      await t.db
        .update(schema.markets)
        .set({ status: 'closed' })
        .where(eq(schema.markets.id, t.market.id));
      expect(await scanResolved(t.db, t.world.polygonChain)).toBe(0);
    });

    it('winning position: redeem through the policy layer, bridge back, close', async () => {
      await resolve([1n, 0n]);
      expect(await scanResolved(t.db, t.world.polygonChain)).toBe(1);
      expect(await scanResolved(t.db, t.world.polygonChain)).toBe(0); // one live exit per position
      const [e] = await t.db.select().from(schema.exits);
      expect(await t.exits().run(e!.id)).toBe('done');
      const done = await exit(e!.id);
      expect(done.status).toBe('done');
      expect(done.ctx.redeemTx).toBeTruthy();
      expect(Number(done.ctx.proceedsUsdc)).toBeGreaterThan(18_000_000); // $1 per share
      expect(t.world.count).toMatchObject({ redeems: 1, settles: 1, closes: 1 });
      expect(t.world.settledFor[0]).not.toBe(zeroHash);
      expect(t.world.pusd).toBe(0n);
      expect((await position()).status).toBe('closed');
      expect((await notes()).at(-1)!.title).toBe('Position redeemed');
    });

    it('losing position: pays nothing and only writes off the Vault claim', async () => {
      await resolve([0n, 1n]);
      await scanResolved(t.db, t.world.polygonChain);
      const [e] = await t.db.select().from(schema.exits);
      expect(await t.exits().run(e!.id)).toBe('done');
      expect(t.world.count).toMatchObject({ settles: 0, closes: 1 });
      expect((await exit(e!.id)).ctx.proceedsUsdc).toBe('0');
      expect((await position()).status).toBe('closed');
    });

    it('honours returnTo polygon on auto-redeem', async () => {
      await t.db.update(schema.positions).set({ returnTo: 'polygon' });
      await resolve([1n, 0n]);
      await scanResolved(t.db, t.world.polygonChain);
      const [e] = await t.db.select().from(schema.exits);
      await t.exits().run(e!.id);
      expect(t.world.count).toMatchObject({ settles: 0, closes: 1 });
      expect(t.world.pusd).toBeGreaterThan(18_000_000n);
    });

    it('auto-redeems neg-risk positions through the NegRiskCtfCollateralAdapter only', async () => {
      await t.db.update(schema.positions).set({ negRisk: true });
      await resolve([1n, 0n]);
      expect(await scanResolved(t.db, t.world.polygonChain)).toBe(1);
      const [e] = await t.db.select().from(schema.exits);
      expect(await t.exits().run(e!.id)).toBe('done');
      expect(t.world.count).toMatchObject({ redeems: 1, settles: 1, closes: 1 });
      const calls = t.world.submitted.flatMap((b) => b.calls);
      const redeem = calls.filter((c) => c.data.startsWith(REDEEM_SELECTOR));
      expect(redeem.map((c) => c.target)).toEqual([POLYGON.negRiskCollateralAdapter]);
      expect((await position()).status).toBe('closed');
    });
  });

  describe('idempotent under injected restarts', () => {
    it.each(['after-batch', 'after-order', 'after-settle'])('sell, crash %s', async (point) => {
      const id = await sell();
      t.world.crashPoint = point;
      await expect(t.exits().run(id)).rejects.toThrow(/injected crash/);
      expect(await t.exits().run(id)).toBe('done'); // new engine = restarted process
      expect((await exit(id)).status).toBe('done');
      expect(t.world.count).toMatchObject({ sells: 1, settles: 1, closes: 1 });
      expect((await position()).status).toBe('closed');
      expect((await notes()).filter((n) => n.title === 'Position sold')).toHaveLength(1);
    });

    it('redeem, crash after the redeem batch', async () => {
      await resolve([1n, 0n]);
      await scanResolved(t.db, t.world.polygonChain);
      const [e] = await t.db.select().from(schema.exits);
      t.world.crashPoint = 'after-batch';
      await expect(t.exits().run(e!.id)).rejects.toThrow(/injected crash/);
      expect(await t.exits().run(e!.id)).toBe('done');
      expect(t.world.count).toMatchObject({ redeems: 1, settles: 1, closes: 1 });
    });
  });
});
