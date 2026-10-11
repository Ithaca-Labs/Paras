import { schema, type Database } from '@paras/db';
import { and, eq } from 'drizzle-orm';
import type { WalletService } from '../wallet/service.js';

const { depositWallets, executorSessionKeys } = schema;

/**
 * Demo only: activates a session key for every registered Deposit Wallet without the owner's on-chain grant
 * (nothing is on Polygon). Live mode never calls this; the policy layer still gates every batch and order.
 */
export async function grantDemoSessionKeys(db: Database, svc: WalletService): Promise<void> {
  for (const w of await db
    .select()
    .from(depositWallets)
    .where(eq(depositWallets.status, 'registered'))) {
    const [active] = await db
      .select({ id: executorSessionKeys.id })
      .from(executorSessionKeys)
      .where(and(eq(executorSessionKeys.walletId, w.id), eq(executorSessionKeys.status, 'active')));
    if (active) continue;
    const { keyId } = await svc.beginSessionKeyChange(w.id);
    await db
      .update(executorSessionKeys)
      .set({ status: 'active', activatedAt: new Date() })
      .where(eq(executorSessionKeys.id, keyId));
  }
}
