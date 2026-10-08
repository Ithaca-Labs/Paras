import { schema, type Database } from '@paras/db';
import { getAddress, type Hex } from 'viem';
import type { WalletService } from './service.js';

const { walletRequests } = schema;

/**
 * Turns the API's `wallet_requests` into Deposit Wallets: provisions each requested wallet, and once the user's
 * `RegisterDepositWallet` signature is on file, registers it with the Vault (after the ownership checks in
 * `registerWithVault`). Failures stay per-request so one bad row never blocks the rest.
 */
export async function syncWalletRequests(
  db: Database,
  svc: WalletService,
  log?: (msg: string, data?: object) => void,
): Promise<void> {
  for (const r of await db.select().from(walletRequests)) {
    try {
      const w = await svc.provision({ userId: r.userId, owner: getAddress(r.owner) });
      if (w.status === 'deployed' && r.signature) await svc.registerWithVault(w.id, r.signature as Hex);
    } catch (err) {
      log?.('wallet request failed', { userId: r.userId, err });
    }
  }
}
