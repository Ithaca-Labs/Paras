import { schema } from '@paras/db';
import { apiRoutes } from '@paras/shared';
import { eq } from 'drizzle-orm';
import { formatUnits, getAddress } from 'viem';
import { HttpError } from '../errors.js';
import { implement } from '../implement.js';
import type { RoutePlugin } from './index.js';

const usdc = (n: bigint) => formatUnits(n, 6);

export const vaultRoutes: RoutePlugin = (app, { db, vault }) => {
  implement(
    app,
    apiRoutes.getVaultBalances,
    async (_req, { auth }) => {
      if (!vault) throw new HttpError(503, 'vault_unavailable', 'Vault chain is not configured');
      const links = await db
        .select({ address: schema.walletLinks.address })
        .from(schema.walletLinks)
        .where(eq(schema.walletLinks.userId, auth.userId));
      const addrs = links.map((l) => getAddress(l.address));
      const rows = addrs.length ? await vault.accounts(addrs) : [];
      const sum = { idle: 0n, reserved: 0n, inFlight: 0n };
      for (const r of rows) {
        sum.idle += r.idle;
        sum.reserved += r.reserved;
        sum.inFlight += r.inFlight;
      }
      return {
        vault: vault.vault.toLowerCase(),
        chainId: vault.chainId,
        total: {
          idle: usdc(sum.idle),
          reserved: usdc(sum.reserved),
          inFlight: usdc(sum.inFlight),
        },
        accounts: rows.map((r, i) => ({
          address: addrs[i]!.toLowerCase(),
          idle: usdc(r.idle),
          reserved: usdc(r.reserved),
          inFlight: usdc(r.inFlight),
          depositWallet: r.depositWallet?.toLowerCase() ?? null,
        })),
      };
    },
    { auth: 'required', scope: 'portfolio:read' },
  );
};
