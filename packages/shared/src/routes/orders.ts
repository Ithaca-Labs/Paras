import { defineRoute } from '../route.js';
import { DecimalString, PriceString } from '../venue.js';
import { z } from '../zod.js';

const hours = (max: number) => z.number().int().min(1).max(max);

const CreateOrderBody = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('limit_buy'),
    eventId: z.string().uuid(),
    /** Venue-agnostic Outcome label of the Event, e.g. "Yes". */
    outcome: z.string().min(1),
    /** USDC to spend, at most the delegation's per-Intent max. */
    amount: DecimalString,
    /** Buy when the best ask is at or below this; also the Intent's worst price. */
    triggerPrice: PriceString,
    expiresInHours: hours(24 * 30).default(24),
  }),
  z.object({
    kind: z.enum(['take_profit', 'stop_loss']),
    positionId: z.string().uuid(),
    /** Take-profit: sell when the bid is at or above. Stop-loss: at or below. */
    triggerPrice: PriceString,
    /** Worst price per share to accept. Take-profit defaults to the trigger; stop-loss requires it and it must be <= the trigger. */
    limitPrice: PriceString.optional(),
    /** Shares to sell; omit for everything held at trigger time. */
    shares: DecimalString.optional(),
    expiresInHours: hours(24 * 30).default(24 * 30),
  }),
]);

export const Order = z.object({
  id: z.string().uuid(),
  kind: z.enum(['limit_buy', 'take_profit', 'stop_loss']),
  status: z.enum(['open', 'triggered', 'placed', 'cancelled', 'expired', 'failed']),
  eventId: z.string().uuid().nullable(),
  outcome: z.string().nullable(),
  /** USDC (limit buys). */
  amount: DecimalString.nullable(),
  positionId: z.string().uuid().nullable(),
  triggerPrice: PriceString,
  limitPrice: PriceString.nullable(),
  expiresAt: z.iso.datetime().nullable(),
  /** The Intent (limit buy) or exit (take-profit / stop-loss) it placed. */
  intentId: z.string().uuid().nullable(),
  exitId: z.string().uuid().nullable(),
  reason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  triggeredAt: z.iso.datetime().nullable(),
});
export type Order = z.infer<typeof Order>;

export const createOrder = defineRoute({
  method: 'post',
  path: '/v1/orders',
  operationId: 'createOrder',
  summary:
    'Create a conditional order: limit buy, or take-profit / stop-loss on a position. Needs an active Privy delegation (409 no_active_delegation); Paras places it through the delegated signer when the Quote crosses the trigger. 409 would_trigger_now for a take-profit/stop-loss already past its trigger',
  tags: ['orders'],
  status: 201,
  request: { body: CreateOrderBody },
  response: Order,
});
export type CreateOrderBody = z.output<typeof CreateOrderBody>;

export const listOrders = defineRoute({
  method: 'get',
  path: '/v1/orders',
  operationId: 'listOrders',
  summary: "The caller's conditional orders, newest first",
  tags: ['orders'],
  request: {},
  response: z.object({ items: z.array(Order) }),
});

export const cancelOrder = defineRoute({
  method: 'post',
  path: '/v1/orders/{id}/cancel',
  operationId: 'cancelOrder',
  summary: 'Cancel an open order (409 if it already triggered)',
  tags: ['orders'],
  request: { params: z.object({ id: z.string().uuid() }) },
  response: Order,
});

export const oneClickBet = defineRoute({
  method: 'post',
  path: '/v1/vault/bet',
  operationId: 'oneClickBet',
  summary:
    'Place a bet now through the Privy delegated signer: previews the Intent, signs it with the delegated signer and submits it to the Vault. The User chose the Event, Outcome, amount and max price. 409 no_active_delegation; 422 bet_blocked when the preview is blocked (Vault eligibility, balance, no Route)',
  tags: ['orders'],
  status: 201,
  request: {
    body: z.object({
      eventId: z.string().uuid(),
      outcome: z.string().min(1),
      amount: DecimalString,
      maxPrice: PriceString,
    }),
  },
  response: z.object({ intentId: z.string().uuid(), txHash: z.string() }),
});
