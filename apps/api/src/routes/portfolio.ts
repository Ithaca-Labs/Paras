import { schema } from '@paras/db';
import { resolutionState, toBase6, txUrl, valuePosition, type TxChain } from '@paras/domain';
import { apiRoutes, type HistoryItem } from '@paras/shared';
import { and, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { formatUnits } from 'viem';
import { HttpError, notFound } from '../errors.js';
import { implement } from '../implement.js';
import type { RoutePlugin } from './index.js';

const {
  chainTransfers,
  depositWallets,
  exits,
  intents,
  latestQuotes,
  markets,
  outcomes,
  positions,
  vaultActivity,
  walletLinks,
} = schema;

const usdc = (n: bigint) => formatUnits(n, 6);
/** No progress for this long on a live step = delayed. */
const STALL_MS = 15 * 60_000;

export const portfolioRoutes: RoutePlugin = (app, { db, now = () => new Date() }) => {
  type MarketRow = Pick<
    typeof markets.$inferSelect,
    'id' | 'question' | 'status' | 'endDate' | 'meta'
  >;
  const marketsById = async (ids: string[]) =>
    new Map<string, MarketRow>(
      ids.length
        ? (
            await db
              .select({
                id: markets.id,
                question: markets.question,
                status: markets.status,
                endDate: markets.endDate,
                meta: markets.meta,
              })
              .from(markets)
              .where(inArray(markets.id, ids))
          ).map((m) => [m.id, m])
        : [],
    );
  const resolutionOf = (m: MarketRow | undefined) =>
    m
      ? resolutionState(
          {
            status: m.status,
            endDate: m.endDate,
            umaStatus:
              typeof m.meta.umaResolutionStatus === 'string' ? m.meta.umaResolutionStatus : null,
          },
          now(),
        )
      : null;

  implement(
    app,
    apiRoutes.getPortfolio,
    async (_req, { auth }) => {
      const rows = await db
        .select()
        .from(positions)
        .where(eq(positions.userId, auth.userId))
        .orderBy(desc(positions.createdAt));
      const mk = await marketsById([...new Set(rows.map((p) => p.marketId))]);
      const oc = new Map(
        rows.length
          ? (
              await db
                .select({
                  id: outcomes.id,
                  label: outcomes.label,
                  bid: latestQuotes.bid,
                  last: latestQuotes.last,
                })
                .from(outcomes)
                .leftJoin(latestQuotes, eq(latestQuotes.outcomeId, outcomes.id))
                .where(
                  inArray(
                    outcomes.id,
                    rows.map((p) => p.outcomeId),
                  ),
                )
            ).map((o) => [o.id, o])
          : [],
      );
      const exitRows = rows.length
        ? await db
            .select()
            .from(exits)
            .where(
              inArray(
                exits.positionId,
                rows.map((p) => p.id),
              ),
            )
            .orderBy(desc(exits.createdAt))
        : [];

      // Indexer view of the Deposit Wallet.
      const [wallet] = await db
        .select({ a: depositWallets.walletAddress })
        .from(depositWallets)
        .where(and(eq(depositWallets.userId, auth.userId), ne(depositWallets.status, 'pending')));
      const held = new Map<string, bigint>();
      if (wallet)
        for (const r of await db
          .select({ asset: chainTransfers.asset, b: sql<string>`sum(${chainTransfers.delta})` })
          .from(chainTransfers)
          .where(eq(chainTransfers.wallet, wallet.a.toLowerCase()))
          .groupBy(chainTransfers.asset))
          held.set(r.asset, BigInt(r.b));

      const tot = { value: 0n, costBasis: 0n, unrealized: 0n, realized: 0n };
      const out = rows.map((p) => {
        const mine = exitRows.filter((e) => e.positionId === p.id);
        const proceeds = mine.reduce((a, e) => a + BigInt(e.ctx.proceedsUsdc ?? '0'), 0n);
        const o = oc.get(p.outcomeId);
        const price = o?.bid ?? o?.last ?? null;
        const open = p.status === 'open';
        const v = valuePosition({
          shares: BigInt(p.shares),
          sharesBought: BigInt(p.sharesBought),
          cost: BigInt(p.costUsdc),
          proceeds,
          price: open ? price : '0',
        });
        tot.value += v.value;
        tot.costBasis += v.costBasis;
        tot.unrealized += v.unrealized;
        tot.realized += v.realized;
        const e = mine[0];
        return {
          id: p.id,
          eventId: p.eventId,
          marketId: p.marketId,
          outcomeId: p.outcomeId,
          venueId: p.venueId,
          question: mk.get(p.marketId)?.question ?? '',
          outcome: o?.label ?? '',
          status: p.status,
          shares: usdc(BigInt(p.shares)),
          onchainShares: wallet ? usdc(held.get(p.tokenId) ?? 0n) : null,
          avgCost: usdc((BigInt(p.costUsdc) * 1_000_000n) / (BigInt(p.sharesBought) || 1n)),
          price,
          costBasis: usdc(v.costBasis),
          value: usdc(v.value),
          unrealizedPnl: usdc(v.unrealized),
          realizedPnl: usdc(v.realized),
          returnTo: p.returnTo,
          resolution: resolutionOf(mk.get(p.marketId)) ?? {
            state: 'open' as const,
            delayed: false,
          },
          exit: e
            ? { id: e.id, kind: e.kind, status: e.status, reason: e.ctx.reason ?? null }
            : null,
        };
      });
      return {
        positions: out,
        totals: {
          value: usdc(tot.value),
          costBasis: usdc(tot.costBasis),
          unrealizedPnl: usdc(tot.unrealized),
          realizedPnl: usdc(tot.realized),
          pnl: usdc(tot.unrealized + tot.realized),
        },
        collateral: {
          wallet: wallet?.a.toLowerCase() ?? null,
          pusd: usdc(held.get('pusd') ?? 0n),
        },
      };
    },
    { auth: 'required', scope: 'portfolio:read' },
  );

  // ------------------------------------------------------------ history

  implement(
    app,
    apiRoutes.listHistory,
    async ({ query }, { auth }) => {
      const before = query.cursor ? new Date(query.cursor) : undefined;
      const n = query.limit;
      const links = (
        await db
          .select({ a: walletLinks.address })
          .from(walletLinks)
          .where(eq(walletLinks.userId, auth.userId))
      ).map((l) => l.a);

      const buys = await db
        .select()
        .from(intents)
        .where(
          and(
            eq(intents.userId, auth.userId),
            ne(intents.status, 'previewed'),
            before && lt(intents.createdAt, before),
          ),
        )
        .orderBy(desc(intents.createdAt))
        .limit(n + 1);
      const outs = await db
        .select()
        .from(exits)
        .where(and(eq(exits.userId, auth.userId), before && lt(exits.createdAt, before)))
        .orderBy(desc(exits.createdAt))
        .limit(n + 1);
      const cash = links.length
        ? await db
            .select()
            .from(vaultActivity)
            .where(
              and(
                inArray(vaultActivity.userAddress, links),
                before && lt(vaultActivity.at, before),
              ),
            )
            .orderBy(desc(vaultActivity.at))
            .limit(n)
        : [];
      const pos = await db.select().from(positions).where(eq(positions.userId, auth.userId));
      const mk = await marketsById([
        ...new Set([...buys.map((b) => b.details.marketId), ...pos.map((p) => p.marketId)]),
      ]);
      const posById = new Map(pos.map((p) => [p.id, p]));

      const tx = (label: string, chain: TxChain, hash?: string | null) =>
        hash ? [{ label, chain, hash, url: txUrl(chain, hash) }] : [];
      const stalled = (status: string, terminal: string[], at: Date) =>
        !terminal.includes(status) && now().getTime() - at.getTime() > STALL_MS;

      const items: HistoryItem[] = [
        ...buys.map((b): HistoryItem => {
          const m = mk.get(b.details.marketId);
          const c = b.ctx;
          const terminal = ['filled', 'partially_filled', 'failed', 'expired', 'cancelled'];
          const state = stalled(b.status, terminal, b.updatedAt)
            ? 'delayed'
            : b.status === 'failed'
              ? 'failed'
              : b.status === 'expired' || b.status === 'cancelled'
                ? 'cancelled'
                : terminal.includes(b.status)
                  ? 'complete'
                  : 'pending';
          return {
            id: b.id,
            kind: 'bet',
            at: b.createdAt.toISOString(),
            state,
            status: b.status,
            amount: usdc(BigInt(b.amountUsdc)),
            shares: c.filledShares ? usdc(toBase6(c.filledShares)) : null,
            question: m?.question ?? null,
            resolution: resolutionOf(m),
            reason: c.reason ?? null,
            txs: [
              ...tx('Intent signed', 'monad', c.submitTx),
              ...tx('Dispatched to Polygon', 'monad', c.dispatchTx),
              ...tx('Swapped and wrapped to pUSD', 'polygon', c.convertTx),
              ...tx('Remainder returned', 'polygon', c.returnTx),
              ...tx('Credited to Vault', 'monad', c.settleTx),
            ],
          };
        }),
        ...outs.map((e): HistoryItem => {
          const p = posById.get(e.positionId);
          const m = p ? mk.get(p.marketId) : undefined;
          const c = e.ctx;
          const state = stalled(e.status, ['done', 'failed'], e.updatedAt)
            ? 'delayed'
            : e.status === 'done'
              ? 'complete'
              : e.status === 'failed'
                ? 'failed'
                : 'pending';
          const gone = c.soldShares ?? c.sellShares ?? e.shares;
          return {
            id: e.id,
            kind: e.kind === 'sell' ? 'exit' : 'redemption',
            at: e.createdAt.toISOString(),
            state,
            status: e.status,
            amount: c.proceedsUsdc ? usdc(BigInt(c.proceedsUsdc)) : null,
            shares: gone ? usdc(BigInt(gone)) : null,
            question: m?.question ?? null,
            resolution: resolutionOf(m),
            reason: c.reason ?? null,
            txs: [
              ...tx('Exchange approval', 'polygon', c.approvalTx),
              ...tx('Redeemed', 'polygon', c.redeemTx),
              ...tx('Proceeds sent to Vault', 'polygon', c.returnTx),
              ...tx('Credited to Vault', 'monad', c.settleTx),
            ],
          };
        }),
        ...cash.map((a): HistoryItem => ({
          id: a.id,
          kind: a.kind,
          at: a.at.toISOString(),
          state: 'complete',
          status: null,
          amount: usdc(BigInt(a.amountUsdc)),
          shares: null,
          question: null,
          resolution: null,
          reason: null,
          txs: tx(a.kind === 'deposit' ? 'Deposit' : 'Withdrawal', 'monad', a.txHash),
        })),
      ].sort((a, b) => b.at.localeCompare(a.at));
      const page = items.slice(0, n);
      return {
        items: page,
        nextCursor: items.length > n ? page.at(-1)!.at : null,
      };
    },
    { auth: 'required', scope: 'portfolio:read' },
  );

  // ------------------------------------------------------------ exits

  const myPosition = async (userId: string, id: string) => {
    const [p] = await db
      .select()
      .from(positions)
      .where(and(eq(positions.id, id), eq(positions.userId, userId)));
    if (!p) throw notFound('Position');
    return p;
  };

  implement(
    app,
    apiRoutes.exitPosition,
    async ({ params, body }, { auth }) => {
      const p = await myPosition(auth.userId, params.id);
      if (p.status !== 'open') throw new HttpError(409, 'position_closed', 'Position is closed');
      const price = Number(body.minPrice);
      if (!(price > 0 && price < 1))
        throw new HttpError(400, 'validation_error', 'minPrice must be between 0 and 1');
      const shares = body.shares ? toBase6(body.shares) : BigInt(p.shares);
      if (shares <= 0n || shares > BigInt(p.shares))
        throw new HttpError(
          400,
          'validation_error',
          'shares must be between 0 and the shares held',
        );
      const [m] = await db
        .select({ s: markets.status })
        .from(markets)
        .where(eq(markets.id, p.marketId));
      if (m?.s === 'resolved')
        throw new HttpError(
          409,
          'market_resolved',
          'Market resolved: it will be redeemed, not sold',
        );
      const [e] = await db
        .insert(exits)
        .values({
          positionId: p.id,
          userId: auth.userId,
          kind: 'sell',
          shares: shares.toString(),
          minPrice: body.minPrice,
          returnTo: body.returnTo ?? p.returnTo,
        })
        .onConflictDoNothing()
        .returning();
      if (!e) throw new HttpError(409, 'exit_in_progress', 'This position already has a live exit');
      return { id: e.id, kind: e.kind, status: e.status, reason: null };
    },
    { auth: 'required' },
  );

  implement(
    app,
    apiRoutes.setPositionReturn,
    async ({ params, body }, { auth }) => {
      const p = await myPosition(auth.userId, params.id);
      await db
        .update(positions)
        .set({ returnTo: body.returnTo, updatedAt: now() })
        .where(eq(positions.id, p.id));
      return { returnTo: body.returnTo };
    },
    { auth: 'required' },
  );
};
