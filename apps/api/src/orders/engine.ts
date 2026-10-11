import { isDispatchPaused, notify, schema, type Database, type NotifyMailer } from '@paras/db';
import { exitTypedData, shouldTrigger, type TriggerQuote } from '@paras/domain';
import { DelegationError, type DelegatedSigner } from '@paras/privy';
import { and, eq } from 'drizzle-orm';
import { formatUnits } from 'viem';
import { loadOutcomeGroups } from '../events/compare.js';
import { previewIntentFor, type Countries, type PreviewDeps } from '../intents/preview.js';
import { QUOTE_STALE_AFTER_MS } from '../deps.js';

const { conditionalOrders, delegations, exits, latestQuotes, positions, privyWallets } = schema;
type OrderRow = typeof conditionalOrders.$inferSelect;

export interface OrderDeps extends PreviewDeps {
  signer: DelegatedSigner;
  mailer?: NotifyMailer;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

/** The order cannot be placed as asked. `retry`: transient (Venue paused), keep the order open. */
export class OrderFailure extends Error {
  constructor(
    message: string,
    readonly retry = false,
  ) {
    super(message);
  }
}

/** The User's active Privy delegation and its wallet, or null. */
export async function activeDelegation(db: Database, userId: string) {
  const [row] = await db
    .select({ maxIntent: delegations.maxIntentUsdc, address: privyWallets.address })
    .from(delegations)
    .innerJoin(privyWallets, eq(privyWallets.walletId, delegations.walletId))
    .where(and(eq(delegations.userId, userId), eq(delegations.status, 'active')));
  return row ? { wallet: row.address, maxIntent: BigInt(row.maxIntent) } : null;
}

/** Preview, sign with the delegated signer and submit one Intent. Used by limit buys and one-click bets. */
export async function placeBet(
  d: OrderDeps,
  userId: string,
  wallet: string,
  p: { eventId: string; outcome: string; amount: string; maxPrice: string },
  vc: Countries,
) {
  const preview = await previewIntentFor(
    d,
    userId,
    { ...p, user: wallet as `0x${string}`, remainder: 'return', expiresInMinutes: 60 },
    vc,
  );
  if (!preview.intent) {
    throw new OrderFailure(
      preview.blockers.length
        ? `blocked: ${preview.blockers.join(', ')}`
        : (preview.noRoute?.reason ?? 'no_route'),
    );
  }
  if (await isDispatchPaused(d.db, preview.route!.venueId))
    throw new OrderFailure('venue paused', true);
  const t = preview.intent.typedData;
  const message = {
    user: t.message.user as `0x${string}`,
    id: t.message.id as `0x${string}`,
    amount: BigInt(t.message.amount),
    expiry: BigInt(t.message.expiry),
    detailsHash: t.message.detailsHash as `0x${string}`,
  };
  const sig = await d.signer.signIntent(userId, { ...t, message });
  const tx = await d.signer.submitIntent(userId, message, sig);
  return { intentId: preview.intent.id, txHash: tx.hash };
}

async function placeExit(d: OrderDeps, o: OrderRow) {
  const [p] = await d.db.select().from(positions).where(eq(positions.id, o.positionId!));
  if (!p || p.status !== 'open') throw new OrderFailure('position_closed');
  if (await isDispatchPaused(d.db, p.venueId)) throw new OrderFailure('venue paused', true);
  const held = BigInt(p.shares);
  const shares = o.shares && BigInt(o.shares) < held ? BigInt(o.shares) : held;
  const minPrice = o.limitPrice ?? o.triggerPrice;
  const typed = exitTypedData({
    user: p.userAddress,
    positionId: p.id,
    shares,
    minPrice,
    returnTo: p.returnTo,
    deadline: BigInt(Math.floor(d.now().getTime() / 1000) + 300),
  });
  const signature = await d.signer.signExit(o.userId, typed);
  const [e] = await d.db
    .insert(exits)
    .values({
      positionId: p.id,
      userId: o.userId,
      kind: 'sell',
      shares: shares.toString(),
      minPrice,
      returnTo: p.returnTo,
      signature: signature.toLowerCase(),
    })
    .onConflictDoNothing()
    .returning({ id: exits.id });
  if (!e) throw new OrderFailure('exit_in_progress');
  return e.id;
}

const fresh = (at: Date, now: Date) => now.getTime() - at.getTime() <= QUOTE_STALE_AFTER_MS;
const num = (v: string | null) => (v === null ? null : Number(v));

/** Best fresh bid/ask relevant to the order, or null when there is no usable Quote. */
async function quoteFor(d: OrderDeps, o: OrderRow): Promise<TriggerQuote | null> {
  const now = d.now();
  if (o.kind === 'limit_buy') {
    const rows = (await loadOutcomeGroups(d.db, o.eventId!)).get(o.outcome!.trim().toLowerCase());
    const asks = (rows ?? [])
      .filter(
        (r) =>
          r.market.status === 'open' &&
          r.venue.capabilities.routable &&
          r.quote &&
          fresh(r.quote.observedAt, now),
      )
      .map((r) => num(r.quote!.ask))
      .filter((a): a is number => a !== null);
    return asks.length ? { bid: null, ask: Math.min(...asks) } : null;
  }
  const [row] = await d.db
    .select({ q: latestQuotes })
    .from(positions)
    .innerJoin(latestQuotes, eq(latestQuotes.outcomeId, positions.outcomeId))
    .where(eq(positions.id, o.positionId!));
  return row && fresh(row.q.observedAt, now) ? { bid: num(row.q.bid), ask: null } : null;
}

/** One pass over open orders. A trigger fires at most once: the `open` to `triggered` claim is atomic. */
export async function runOrders(d: OrderDeps): Promise<{ placed: number; failed: number }> {
  const { db } = d;
  const now = d.now();
  const counts = { placed: 0, failed: 0 };
  const set = (id: string, v: Partial<OrderRow>) =>
    db
      .update(conditionalOrders)
      .set({ ...v, updatedAt: now })
      .where(eq(conditionalOrders.id, id));
  if (await isDispatchPaused(db, 'global')) return counts;

  for (const o of await db
    .select()
    .from(conditionalOrders)
    .where(eq(conditionalOrders.status, 'open'))) {
    if (o.expiresAt && o.expiresAt <= now) {
      await set(o.id, { status: 'expired' });
      continue;
    }
    const q = await quoteFor(d, o).catch(() => null);
    if (!q || !shouldTrigger(o.kind, Number(o.triggerPrice), q)) continue;

    const claimed = await db
      .update(conditionalOrders)
      .set({ status: 'triggered', triggeredAt: now, updatedAt: now })
      .where(and(eq(conditionalOrders.id, o.id), eq(conditionalOrders.status, 'open')))
      .returning({ id: conditionalOrders.id });
    if (!claimed.length) continue;

    const what = o.kind === 'limit_buy' ? 'Limit buy' : o.kind.replace('_', '-');
    const tell = (verb: string, body: string) =>
      notify(
        db,
        d.mailer,
        {
          ownerKey: `u:${o.userId}`,
          kind: 'intent_update',
          dedupeKey: `order:${o.id}:${verb}`,
          title: `${what} order ${verb}`,
          body,
          ...(o.eventId && { eventId: o.eventId }),
        },
        now,
      );
    try {
      if (o.kind === 'limit_buy') {
        const vc: Countries = {
          ipCountry: o.ipCountry,
          attestedCountry: await attested(db, o.userId),
          countries: [],
        };
        vc.countries = [vc.ipCountry, vc.attestedCountry].filter((c): c is string => c !== null);
        const del = await activeDelegation(db, o.userId);
        if (!del) throw new OrderFailure('no_active_delegation');
        const r = await placeBet(
          d,
          o.userId,
          del.wallet,
          {
            eventId: o.eventId!,
            outcome: o.outcome!,
            amount: formatUnits(BigInt(o.amountUsdc!), 6),
            maxPrice: o.triggerPrice,
          },
          vc,
        );
        await set(o.id, { status: 'placed', intentRowId: r.intentId });
      } else {
        await set(o.id, { status: 'placed', exitId: await placeExit(d, o) });
      }
      counts.placed++;
      await tell('placed', `Your ${what.toLowerCase()} order triggered and was placed.`);
    } catch (err) {
      if (err instanceof OrderFailure && err.retry) {
        await set(o.id, { status: 'open', triggeredAt: null });
        continue;
      }
      const reason =
        err instanceof OrderFailure
          ? err.message
          : err instanceof DelegationError
            ? err.code
            : 'internal_error';
      if (reason === 'internal_error') d.log?.('order failed', { id: o.id, err: String(err) });
      await set(o.id, { status: 'failed', reason });
      counts.failed++;
      await tell('failed', `Your ${what.toLowerCase()} order could not be placed: ${reason}.`);
    }
  }
  return counts;
}

async function attested(db: Database, userId: string) {
  const [u] = await db
    .select({ c: schema.users.attestedCountry })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return u?.c ?? null;
}

/** Runs `runOrders` every `everyMs` (no overlap). Returns a stop function. */
export function startOrderEngine(d: OrderDeps, everyMs = 15_000) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runOrders(d)
      .catch((err) => d.log?.('order engine error', { err: String(err) }))
      .finally(() => (running = false));
  }, everyMs);
  return () => clearInterval(timer);
}
