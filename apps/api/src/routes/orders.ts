import { schema } from '@paras/db';
import { toBase6, validateTrigger } from '@paras/domain';
import { createDelegatedSigner, DelegationError } from '@paras/privy';
import { apiRoutes, type Order } from '@paras/shared';
import { and, desc, eq } from 'drizzle-orm';
import { formatUnits, parseUnits } from 'viem';
import { HttpError, notFound } from '../errors.js';
import { loadOutcomeGroups } from '../events/compare.js';
import { implement } from '../implement.js';
import { headerGeo, viewerCountries } from '../jurisdiction.js';
import {
  activeDelegation,
  OrderFailure,
  placeBet,
  startOrderEngine,
  type OrderDeps,
} from '../orders/engine.js';
import type { RoutePlugin } from './index.js';

const { conditionalOrders, latestQuotes, positions } = schema;
type Row = typeof conditionalOrders.$inferSelect;

const view = (o: Row): Order => ({
  id: o.id,
  kind: o.kind,
  status: o.status,
  eventId: o.eventId,
  outcome: o.outcome,
  amount: o.amountUsdc ? formatUnits(BigInt(o.amountUsdc), 6) : null,
  positionId: o.positionId,
  triggerPrice: o.triggerPrice,
  limitPrice: o.limitPrice,
  expiresAt: o.expiresAt?.toISOString() ?? null,
  intentId: o.intentRowId,
  exitId: o.exitId,
  reason: o.reason,
  createdAt: o.createdAt.toISOString(),
  triggeredAt: o.triggeredAt?.toISOString() ?? null,
});

export const orderRoutes: RoutePlugin = (
  app,
  {
    db,
    adapters,
    vault,
    privy,
    auth: authDeps,
    geo = headerGeo,
    orderPollMs = 0,
    now = () => new Date(),
  },
) => {
  const need = () => {
    if (!privy || !vault) throw new HttpError(503, 'privy_unavailable', 'Privy is not configured');
    return { privy, vault };
  };
  const engineDeps = (): OrderDeps => {
    const n = need();
    return {
      db,
      adapters,
      vault: n.vault,
      now,
      warn: (err, venueId) => app.log.warn({ err, venueId }, 'order book fetch failed'),
      signer: createDelegatedSigner({
        privy: n.privy.port,
        db,
        vault: n.vault.vault,
        chainId: n.vault.chainId,
      }),
      mailer: authDeps.mailer,
    };
  };
  if (orderPollMs > 0 && privy && vault) {
    let stop: (() => void) | undefined;
    app.addHook('onReady', async () => {
      stop = startOrderEngine(
        { ...engineDeps(), log: (msg, data) => app.log.info(data, msg) },
        orderPollMs,
      );
    });
    app.addHook('onClose', async () => stop?.());
  }
  const delegated = async (userId: string) => {
    const del = await activeDelegation(db, userId);
    if (!del)
      throw new HttpError(409, 'no_active_delegation', 'Enable delegation for one-click orders');
    return del;
  };

  // Plain `auth: 'required'`: OAuth/MCP tokens can never create or place orders.
  implement(
    app,
    apiRoutes.createOrder,
    async ({ body }, { auth, request }) => {
      need();
      const del = await delegated(auth.userId);
      const trigger = Number(body.triggerPrice);
      const expiresAt = new Date(now().getTime() + body.expiresInHours * 3600_000);
      const base = {
        userId: auth.userId,
        kind: body.kind,
        triggerPrice: body.triggerPrice,
        expiresAt,
      };
      let values: typeof conditionalOrders.$inferInsert;
      if (body.kind === 'limit_buy') {
        const amount = parseUnits(body.amount, 6);
        if (amount <= 0n || amount > del.maxIntent)
          throw new HttpError(400, 'over_intent_cap', 'amount exceeds your delegation per-bet max');
        if (!(trigger > 0 && trigger <= 1))
          throw new HttpError(400, 'validation_error', 'triggerPrice must be in (0, 1]');
        const groups = await loadOutcomeGroups(db, body.eventId);
        if (!groups.size) throw notFound('Event');
        if (!groups.has(body.outcome.trim().toLowerCase())) throw notFound('Outcome');
        values = {
          ...base,
          eventId: body.eventId,
          outcome: body.outcome,
          amountUsdc: amount.toString(),
          ipCountry: geo(request),
        };
      } else {
        const [p] = await db
          .select()
          .from(positions)
          .where(and(eq(positions.id, body.positionId), eq(positions.userId, auth.userId)));
        if (!p) throw notFound('Position');
        if (p.status !== 'open') throw new HttpError(409, 'position_closed', 'Position is closed');
        if (p.userAddress !== del.wallet)
          throw new HttpError(
            409,
            'position_not_in_delegated_wallet',
            'Only positions of your Privy wallet can be automated',
          );
        const limit = body.limitPrice ?? (body.kind === 'take_profit' ? body.triggerPrice : null);
        if (!limit || Number(limit) > trigger)
          throw new HttpError(400, 'validation_error', 'limitPrice (<= triggerPrice) is required');
        const shares = body.shares ? toBase6(body.shares) : null;
        if (shares !== null && (shares <= 0n || shares > BigInt(p.shares)))
          throw new HttpError(400, 'validation_error', 'shares must be within the shares held');
        const [q] = await db
          .select({ bid: latestQuotes.bid })
          .from(latestQuotes)
          .where(eq(latestQuotes.outcomeId, p.outcomeId));
        const bad = validateTrigger(body.kind, trigger, {
          bid: q?.bid == null ? null : Number(q.bid),
          ask: null,
        });
        if (bad === 'would_trigger_now')
          throw new HttpError(409, bad, 'Already past its trigger: sell the position instead');
        if (bad) throw new HttpError(400, 'validation_error', bad);
        values = {
          ...base,
          positionId: p.id,
          limitPrice: limit,
          shares: shares?.toString() ?? null,
        };
      }
      const [row] = await db.insert(conditionalOrders).values(values).returning();
      return view(row!);
    },
    { auth: 'required' },
  );

  implement(
    app,
    apiRoutes.listOrders,
    async (_r, { auth }) => ({
      items: (
        await db
          .select()
          .from(conditionalOrders)
          .where(eq(conditionalOrders.userId, auth.userId))
          .orderBy(desc(conditionalOrders.createdAt))
      ).map(view),
    }),
    { auth: 'required' },
  );

  implement(
    app,
    apiRoutes.cancelOrder,
    async ({ params }, { auth }) => {
      const [done] = await db
        .update(conditionalOrders)
        .set({ status: 'cancelled', updatedAt: now() })
        .where(
          and(
            eq(conditionalOrders.id, params.id),
            eq(conditionalOrders.userId, auth.userId),
            eq(conditionalOrders.status, 'open'),
          ),
        )
        .returning();
      if (done) return view(done);
      const [o] = await db
        .select()
        .from(conditionalOrders)
        .where(and(eq(conditionalOrders.id, params.id), eq(conditionalOrders.userId, auth.userId)));
      if (!o) throw notFound('Order');
      if (o.status === 'cancelled') return view(o);
      throw new HttpError(409, 'order_not_open', `Order is ${o.status}`);
    },
    { auth: 'required' },
  );

  implement(
    app,
    apiRoutes.oneClickBet,
    async ({ body }, { auth, request }) => {
      const d = engineDeps();
      const del = await delegated(auth.userId);
      const vc = await viewerCountries(db, geo, request, auth);
      try {
        return await placeBet(d, auth.userId, del.wallet, body, vc);
      } catch (err) {
        if (err instanceof OrderFailure) throw new HttpError(422, 'bet_blocked', err.message);
        if (err instanceof DelegationError)
          throw new HttpError(403, 'delegation_refused', err.message);
        throw err;
      }
    },
    { auth: 'required' },
  );
};
