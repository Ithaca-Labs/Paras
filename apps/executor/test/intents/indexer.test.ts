import { schema } from '@paras/db';
import { sql } from 'drizzle-orm';
import { getAddress, pad, toHex, type Address } from 'viem';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { indexPolygon } from '../../src/indexer/polygon.js';
import type { PolygonLogs, WalletTransfer } from '../../src/intents/ports.js';
import { pollVault } from '../../src/intents/runner.js';
import { createHarness, type Harness } from './world.js';

describe('Polygon indexer and Vault activity', () => {
  let t: Harness;
  beforeEach(async () => {
    t = await createHarness();
  });
  afterEach(() => t.close());

  const tx = (n: number) => pad(toHex(n), { size: 32 });
  const balance = async (asset: string) =>
    (
      await t.db
        .select({ b: sql<string>`coalesce(sum(${schema.chainTransfers.delta}), 0)` })
        .from(schema.chainTransfers)
        .where(sql`${schema.chainTransfers.asset} = ${asset}`)
    )[0]!.b;

  it('stores wallet transfers once, advances the cursor, and re-scans safely', async () => {
    const [w] = await t.db.select().from(schema.depositWallets);
    const wallet = getAddress(w!.walletAddress) as Address;
    const seen: [bigint, bigint][] = [];
    const logs: PolygonLogs = {
      head: async () => 5000n,
      transfers: async (from, to, wallets) => {
        seen.push([from, to]);
        expect(wallets).toEqual([wallet]);
        const row = (asset: string, delta: bigint, n: number): WalletTransfer => ({
          wallet,
          asset,
          delta,
          block: from,
          txHash: tx(n),
          logIndex: 0,
        });
        return [
          row('pusd', 10_000_000n, 1),
          row('123', 18_000_000n, 2),
          row('pusd', -4_000_000n, 3),
        ];
      },
    };
    expect(await indexPolygon(t.db, logs, 100n)).toBe(3);
    expect(seen).toEqual([[100n, 2099n]]); // bounded range from the start block
    expect(await balance('pusd')).toBe('6000000');
    expect(await balance('123')).toBe('18000000');

    // The same logs again (overlapping scan): nothing doubles.
    await t.db.delete(schema.chainCursors);
    await indexPolygon(t.db, logs, 100n);
    expect(await balance('pusd')).toBe('6000000');
  });

  it('records Vault deposits and withdrawals for history, ignored by the Intent engine', async () => {
    const at = new Date('2026-10-09T10:00:00Z');
    const vault = {
      ...t.world.vaultChain,
      events: async () => ({
        toBlock: 9n,
        events: [
          {
            kind: 'deposited' as const,
            user: t.userAddress,
            amount: 25_000_000n,
            block: 9n,
            tx: tx(7),
            logIndex: 1,
            at,
          },
          {
            kind: 'withdrawn' as const,
            user: t.userAddress,
            amount: 5_000_000n,
            block: 9n,
            tx: tx(8),
            logIndex: 0,
            at,
          },
        ],
      }),
    };
    expect(await pollVault(t.db, vault, t.engine(), 1n)).toBe(2);
    const rows = await t.db.select().from(schema.vaultActivity);
    expect(rows.map((r) => [r.kind, r.amountUsdc]).sort()).toEqual([
      ['deposit', '25000000'],
      ['withdrawal', '5000000'],
    ]);
  });
});
