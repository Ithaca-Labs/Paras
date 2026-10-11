import type { SmartMoneySignal } from '@paras/domain';
import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { markets } from './markets.js';

/** Cached Nansen smart-money signal per Polymarket Market; `updatedAt` + TTL gate refetching. */
export const smartMoneySignals = pgTable('smart_money_signals', {
  marketId: uuid('market_id')
    .primaryKey()
    .references(() => markets.id, { onDelete: 'cascade' }),
  signal: jsonb('signal').$type<SmartMoneySignal>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Nansen credits spent per UTC day (`YYYY-MM-DD`); enforces the daily cap. */
export const nansenUsage = pgTable('nansen_usage', {
  day: text('day').primaryKey(),
  credits: integer('credits').notNull().default(0),
});
