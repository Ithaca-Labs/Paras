import { schema } from '@paras/db';
import { buildDelegationPolicy } from '@paras/domain';
import { apiRoutes, type Delegation } from '@paras/shared';
import { eq } from 'drizzle-orm';
import { formatUnits, parseUnits } from 'viem';
import { HttpError } from '../errors.js';
import { implement } from '../implement.js';
import type { RoutePlugin } from './index.js';

const { delegations, privyWallets } = schema;
const usdc = (s: string) => formatUnits(BigInt(s), 6);

export const privyRoutes: RoutePlugin = (app, { db, privy, vault, now = () => new Date() }) => {
  const need = () => {
    if (!privy || !vault) throw new HttpError(503, 'privy_unavailable', 'Privy is not configured');
    return { privy, vault };
  };

  async function view(userId: string): Promise<Delegation> {
    const [row] = await db
      .select({ d: delegations, address: privyWallets.address })
      .from(privyWallets)
      .leftJoin(delegations, eq(delegations.walletId, privyWallets.walletId))
      .where(eq(privyWallets.userId, userId));
    const d = row?.d;
    return {
      status: d?.status ?? 'none',
      wallet: row?.address ?? null,
      signerId: d?.signerId ?? null,
      policyIds: d ? [d.policyId] : [],
      maxIntent: d ? usdc(d.maxIntentUsdc) : null,
      cap: d ? usdc(d.capUsdc) : null,
      spent: d ? usdc(d.spentUsdc) : null,
    };
  }

  const myWallet = async (userId: string) => {
    const [w] = await db.select().from(privyWallets).where(eq(privyWallets.userId, userId));
    if (!w) throw new HttpError(409, 'no_privy_wallet', 'Sign in with Privy first');
    return w;
  };

  // Plain `auth: 'required'` (no scope): OAuth/MCP tokens can never reach these.
  implement(app, apiRoutes.getDelegation, (_r, { auth }) => view(auth.userId), {
    auth: 'required',
  });

  implement(
    app,
    apiRoutes.grantDelegation,
    async ({ body }, { auth }) => {
      const { privy: p, vault: v } = need();
      const w = await myWallet(auth.userId);
      const maxIntent = parseUnits(body.maxIntent, 6);
      const cap = parseUnits(body.cap, 6);
      if (maxIntent <= 0n || cap < maxIntent)
        throw new HttpError(400, 'validation_error', 'need 0 < maxIntent <= cap');
      const policy = await p.port.createPolicy(
        buildDelegationPolicy({
          vault: v.vault,
          chainId: v.chainId,
          wallet: w.address,
          maxIntent,
        }),
      );
      const values = {
        userId: auth.userId,
        status: 'pending' as const,
        policyId: policy.id,
        signerId: p.signerId,
        maxIntentUsdc: maxIntent.toString(),
        capUsdc: cap.toString(),
        spentUsdc: '0',
        updatedAt: now(),
      };
      await db
        .insert(delegations)
        .values({ walletId: w.walletId, ...values })
        .onConflictDoUpdate({ target: delegations.walletId, set: values });
      return view(auth.userId);
    },
    { auth: 'required' },
  );

  implement(
    app,
    apiRoutes.confirmDelegation,
    async (_r, { auth }) => {
      const { privy: p } = need();
      const w = await myWallet(auth.userId);
      const [d] = await db.select().from(delegations).where(eq(delegations.walletId, w.walletId));
      if (!d || d.status === 'revoked')
        throw new HttpError(409, 'no_delegation', 'Grant a delegation first');
      if (!(await p.port.walletSigners(w.walletId)).includes(d.signerId))
        throw new HttpError(
          409,
          'delegation_not_registered',
          "Paras's signer is not registered on the wallet yet",
        );
      await db
        .update(delegations)
        .set({ status: 'active', updatedAt: now() })
        .where(eq(delegations.walletId, w.walletId));
      return view(auth.userId);
    },
    { auth: 'required' },
  );

  implement(
    app,
    apiRoutes.revokeDelegation,
    async (_r, { auth }) => {
      await db
        .update(delegations)
        .set({ status: 'revoked', updatedAt: now() })
        .where(eq(delegations.userId, auth.userId));
      return view(auth.userId);
    },
    { auth: 'required' },
  );
};
