import { schema, type Database } from '@paras/db';
import { eq, ne } from 'drizzle-orm';
import { getAddress } from 'viem';
import type { PolygonLogs } from '../intents/ports.js';

const { chainCursors, chainTransfers, depositWallets } = schema;
const CURSOR = 'polygon-wallets';
const MAX_RANGE = 2000n;

/**
 * Polygon indexer: pUSD and CTF share balance changes of every deployed Deposit Wallet, in `chain_transfers`
 * (the portfolio's source of truth for what a wallet holds). Rows are idempotent and the cursor moves only after
 * they are stored, so a crash re-scans harmlessly. A fresh install starts at head: wallets are new, so there is
 * no history to backfill. Returns the number of transfers stored.
 */
export async function indexPolygon(
  db: Database,
  logs: PolygonLogs,
  startBlock?: bigint,
): Promise<number> {
  const wallets = (
    await db
      .select({ a: depositWallets.walletAddress })
      .from(depositWallets)
      .where(ne(depositWallets.status, 'pending'))
  ).map((w) => getAddress(w.a));
  if (!wallets.length) return 0;

  const head = await logs.head();
  const [cur] = await db.select().from(chainCursors).where(eq(chainCursors.name, CURSOR));
  const from = cur ? BigInt(cur.block) + 1n : (startBlock ?? head);
  if (from > head) return 0;
  const to = head < from + MAX_RANGE ? head : from + MAX_RANGE - 1n;

  const found = await logs.transfers(from, to, wallets);
  if (found.length)
    await db
      .insert(chainTransfers)
      .values(
        found.map((t) => ({
          wallet: t.wallet.toLowerCase(),
          asset: t.asset,
          delta: t.delta.toString(),
          block: t.block.toString(),
          txHash: t.txHash,
          logIndex: t.logIndex,
        })),
      )
      .onConflictDoNothing();
  await db
    .insert(chainCursors)
    .values({ name: CURSOR, block: to.toString() })
    .onConflictDoUpdate({ target: chainCursors.name, set: { block: to.toString() } });
  return found.length;
}
