import { schema } from '@paras/db';
import { eq } from 'drizzle-orm';
import { keccak256, recoverAddress, type Hex } from 'viem';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { mintedAmount } from '../../src/intents/cctp.js';
import { createHarness, type Harness } from '../intents/world.js';

describe('testnet demo mode: simulated Polymarket leg (Seam 4, #98)', () => {
  let t: Harness;
  beforeEach(async () => {
    t = await createHarness({ sim: true });
  });
  afterEach(() => t.close());

  it('deposit -> Intent -> simulated fill -> exit -> proceeds settled back to the Vault', async () => {
    const id = await t.newIntent({ amount: 10 });
    expect(await t.engine().run(id)).toBe('done');
    const [intent] = await t.db.select().from(schema.intents).where(eq(schema.intents.id, id));
    expect(intent!.status).toBe('filled');
    // Fill at the live book's best ask (0.50): 9.95 pUSD after the 50 bps swap floor.
    expect(Number(intent!.ctx.filledShares)).toBeCloseTo(19.9, 1);
    expect(t.world.count).toMatchObject({ dispatch: 1, settles: 0 });

    const [pos] = await t.db
      .select()
      .from(schema.positions)
      .where(eq(schema.positions.intentRowId, id));
    const [e] = await t.db
      .insert(schema.exits)
      .values({
        positionId: pos!.id,
        userId: t.userId,
        kind: 'sell',
        shares: pos!.shares,
        minPrice: '0.60',
        returnTo: 'vault',
      })
      .returning();
    expect(await t.exits().run(e!.id)).toBe('done');
    expect(t.world.count).toMatchObject({ settles: 1, closes: 1 });
    const [done] = await t.db
      .select()
      .from(schema.positions)
      .where(eq(schema.positions.id, pos!.id));
    expect(done).toMatchObject({ status: 'closed', shares: '0' });
    // Sold at the best bid 0.65, less swap floors: more than was put in.
    const [msg] = [...t.world.usedMonad] as Hex[];
    expect(mintedAmount(msg!)).toBeGreaterThan(10_000_000n);
  });

  it('attestations are signed by the Executor key (the DemoCctp attester)', async () => {
    const id = await t.newIntent({ amount: 10 });
    await t.engine().run(id);
    const tx = [...t.world.burns.keys()][0]! as Hex;
    const att = await t.sim!.iris.attestation(15, tx);
    expect(mintedAmount(att!.message)).toBe(10_000_000n);
    expect(
      await recoverAddress({ hash: keccak256(att!.message), signature: att!.attestation }),
    ).toBe(t.attester.address);
  });

  it('no liquidity within max price: nothing bought, funds returned', async () => {
    t.world.asks = [{ price: '0.80', size: '10000' }];
    const id = await t.newIntent({ amount: 10, maxPrice: '0.55' });
    expect(await t.engine().run(id)).toBe('done');
    const [intent] = await t.db.select().from(schema.intents).where(eq(schema.intents.id, id));
    expect(intent!.status).toBe('failed');
    expect(t.world.count).toMatchObject({ settles: 1, closes: 1 });
  });
});

describe('demo mode config', () => {
  const env = (o: NodeJS.ProcessEnv) => ({ EXECUTOR_DEMO_MODE: 'simulate', ...o });

  it('is off by default', () => {
    expect(loadConfig({}).EXECUTOR_DEMO_MODE).toBe('off');
  });

  it('only loads on Monad testnet', () => {
    expect(
      loadConfig(env({ EXECUTOR_NETWORK: 'testnet', VAULT_CHAIN_ID: '10143' })).EXECUTOR_DEMO_MODE,
    ).toBe('simulate');
  });

  it.each([
    { EXECUTOR_NETWORK: 'mainnet', VAULT_CHAIN_ID: '143' },
    { EXECUTOR_NETWORK: 'mainnet', VAULT_CHAIN_ID: '10143' },
    { EXECUTOR_NETWORK: 'testnet', VAULT_CHAIN_ID: '143' },
    { EXECUTOR_NETWORK: 'testnet' },
  ])('is impossible on mainnet / unknown chain %j', (e) => {
    expect(() => loadConfig(env(e))).toThrow(/only runs with/);
  });
});
