import type { ConditionalKind, ConditionalStatus } from '@paras/domain';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity.js';
import { positions } from './positions.js';

const tz = (name: string) => timestamp(name, { withTimezone: true });

/**
 * A User's standing order (#93): limit buy, or take-profit / stop-loss on a position. Evaluated on
 * latest Quotes; when triggered, placed through the Privy delegated signer. USDC / shares are base units.
 */
export const conditionalOrders = pgTable(
  'conditional_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').$type<ConditionalKind>().notNull(),
    status: text('status').$type<ConditionalStatus>().notNull().default('open'),
    /** limit_buy: the Event and Outcome label to buy, and the USDC to spend. */
    eventId: uuid('event_id'),
    outcome: text('outcome'),
    amountUsdc: text('amount_usdc'),
    /** take_profit / stop_loss: the position to sell (all held shares unless `shares` is set). */
    positionId: uuid('position_id').references(() => positions.id),
    shares: text('shares'),
    /** Decimal 0..1. Limit buy: also the Intent's max price. */
    triggerPrice: text('trigger_price').notNull(),
    /** Exits: worst price per share to accept (decimal 0..1). */
    limitPrice: text('limit_price'),
    /** Country of the request that created the order: background placement has no IP of its own. */
    ipCountry: text('ip_country'),
    expiresAt: tz('expires_at'),
    intentRowId: uuid('intent_row_id'),
    exitId: uuid('exit_id'),
    reason: text('reason'),
    triggeredAt: tz('triggered_at'),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('conditional_orders_status_idx').on(t.status),
    index('conditional_orders_user_idx').on(t.userId),
  ],
);
