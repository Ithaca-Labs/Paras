import { schema } from '@paras/db';
import { apiRoutes } from '@paras/shared';
import { and, eq } from 'drizzle-orm';
import { HttpError, notFound } from '../errors.js';
import { implement } from '../implement.js';
import type { RoutePlugin } from './index.js';

const NOT_ATOMIC = {
  atomic: false as const,
  note: 'USDC arrives in your Monad wallet first. Depositing it to the Vault is a separate second step.',
};
const QUOTE_TTL_MS = 3600_000;

export const depositRoutes: RoutePlugin = (
  app,
  { db, nearIntents, vault, chain, now = () => new Date() },
) => {
  const ni = () => {
    if (!nearIntents) {
      throw new HttpError(404, 'feature_disabled', 'Any-chain deposit is mainnet-only');
    }
    return nearIntents;
  };

  implement(app, apiRoutes.getConfig, () => ({
    features: { anyChainDeposit: !!nearIntents },
    vault:
      vault && chain
        ? {
            address: vault.vault.toLowerCase() as `0x${string}`,
            chainId: vault.chainId,
            usdc: chain.usdc.toLowerCase() as `0x${string}`,
          }
        : null,
    demoMode: chain?.demo ?? false,
  }));

  implement(
    app,
    apiRoutes.listDepositTokens,
    async () => ({
      items: (await ni().tokens())
        .filter((t) => t.symbol === 'USDC')
        .map(({ assetId, blockchain, symbol, decimals }) => ({
          assetId,
          blockchain,
          symbol,
          decimals,
        })),
    }),
    { auth: 'required' },
  );

  implement(
    app,
    apiRoutes.quoteDeposit,
    async ({ body }, { auth }) => {
      const client = ni();
      // Recipient is always one of the caller's own linked wallets.
      const [link] = await db
        .select({ a: schema.walletLinks.address })
        .from(schema.walletLinks)
        .where(
          and(
            eq(schema.walletLinks.userId, auth.userId),
            eq(schema.walletLinks.address, body.recipient),
          ),
        );
      if (!link) {
        throw new HttpError(403, 'wallet_not_linked', 'Address is not linked to your account');
      }
      const { quote } = await client.quote({
        dry: body.dry,
        originAsset: body.originAsset,
        amount: body.amount,
        refundTo: body.refundTo,
        recipient: body.recipient,
        deadline: new Date(now().getTime() + QUOTE_TTL_MS).toISOString(),
      });
      return {
        ...NOT_ATOMIC,
        recipient: body.recipient,
        ...(quote.depositAddress && { depositAddress: quote.depositAddress }),
        ...(quote.depositMemo && { depositMemo: quote.depositMemo }),
        amountIn: quote.amountIn,
        amountOut: quote.amountOut,
        minAmountOut: quote.minAmountOut,
        ...(quote.deadline && { deadline: quote.deadline }),
        ...(quote.timeEstimate !== undefined && { timeEstimateSeconds: quote.timeEstimate }),
      };
    },
    { auth: 'required' },
  );

  implement(
    app,
    apiRoutes.submitDeposit,
    async ({ body }) => ({ status: (await ni().submit(body)).status }),
    { auth: 'required' },
  );

  implement(
    app,
    apiRoutes.getDepositStatus,
    async ({ query }) => {
      const s = await ni().status(query.depositAddress);
      if (!s) throw notFound('Deposit address');
      return {
        ...NOT_ATOMIC,
        status: s.status,
        updatedAt: s.updatedAt,
        destinationTxHashes: (s.swapDetails?.destinationChainTxHashes ?? []).map((t) => t.hash),
      };
    },
    { auth: 'required' },
  );
};
