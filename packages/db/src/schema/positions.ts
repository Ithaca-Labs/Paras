import type { ExitStatus } from '@paras/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './identity.js';
import { intents } from './intents.js';
import { markets, outcomes } from './markets.js';

const tz = (name: string) => timestamp(name, { withTimezone: true });

/**
 * What a filled (or partly filled) Intent bought. Created by the Executor in the same transaction that
 * finishes the Intent. Amounts are base units (6 decimals) stored as text: shares (CTF) and USDC.
 */
export const positions = pgTable(
  'positions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** The buy: also the Vault Intent whose in-flight claim this position backs. */
    intentRowId: uuid('intent_row_id')
      .notNull()
      .unique()
      .references(() => intents.id),
    /** Lowercase 0x Vault account. */
    userAddress: text('user_address').notNull(),
    eventId: uuid('event_id').notNull(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id),
    outcomeId: uuid('outcome_id')
      .notNull()
      .references(() => outcomes.id),
    venueId: text('venue_id').notNull(),
    /** Venue-native Outcome id (Polymarket: CLOB token id = CTF position id). */
    tokenId: text('token_id').notNull(),
    /** CTF condition id (Polymarket Market external id) and the Outcome's index in it. */
    conditionId: text('condition_id').notNull(),
    outcomeIndex: integer('outcome_index').notNull(),
    negRisk: boolean('neg_risk').notNull().default(false),
    sharesBought: text('shares_bought').notNull(),
    /** Shares still held. */
    shares: text('shares').notNull(),
    /** USDC spent on the fill. */
    costUsdc: text('cost_usdc').notNull(),
    /** Where exit/redemption proceeds go: back to the Vault (default) or stay on Polygon. */
    returnTo: text('return_to').$type<'vault' | 'polygon'>().notNull().default('vault'),
    status: text('status').$type<'open' | 'closed'>().notNull().default('open'),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('positions_user_idx').on(t.userId, t.status)],
);

/** Step data the Executor accumulates per exit (tx hashes, order, amounts in base units). */
export interface ExitCtx {
  approvalTx?: string;
  orderKey?: string;
  /** See IntentCtx.orderTs. */
  orderTs?: number;
  orderId?: string;
  /** Shares the sell order asked for. */
  sellShares?: string;
  soldShares?: string;
  /** Redemption payout owed (base units). */
  payoutUsdc?: string;
  redeemRelayerTx?: string;
  redeemTx?: string;
  /** USDC received (sale or redemption), base units. */
  proceedsUsdc?: string;
  returnPusd?: string;
  returnRelayerTx?: string;
  returnTx?: string;
  returnMessage?: string;
  returnAttestation?: string;
  settleTx?: string;
  closeTx?: string;
  reason?: string;
}

/** A sell (user-requested) or a redemption (Executor, once the Market resolves) of one position. */
export const exits = pgTable(
  'exits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    positionId: uuid('position_id')
      .notNull()
      .references(() => positions.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').$type<'sell' | 'redeem'>().notNull(),
    status: text('status').$type<ExitStatus>().notNull().default('requested'),
    /** Sell only: shares to sell (base units) and the worst price per share the User accepts. */
    shares: text('shares'),
    minPrice: text('min_price'),
    returnTo: text('return_to').$type<'vault' | 'polygon'>().notNull(),
    ctx: jsonb('ctx').$type<ExitCtx>().notNull().default({}),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('exits_position_idx').on(t.positionId),
    // One live exit per position.
    uniqueIndex('exits_active_uq')
      .on(t.positionId)
      .where(sql`${t.status} not in ('done', 'failed')`),
  ],
);

/**
 * Polygon indexer output: signed balance changes of a Deposit Wallet. `asset` is `pusd` or a CTF token id.
 * Idempotent on (tx, log, asset, wallet), so re-scans are safe.
 */
export const chainTransfers = pgTable(
  'chain_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    wallet: text('wallet').notNull(),
    asset: text('asset').notNull(),
    /** Base units, negative when the wallet sent. */
    delta: numeric('delta').notNull(),
    block: text('block').notNull(),
    txHash: text('tx_hash').notNull(),
    logIndex: integer('log_index').notNull(),
  },
  (t) => [
    uniqueIndex('chain_transfers_uq').on(t.txHash, t.logIndex, t.asset, t.wallet),
    index('chain_transfers_wallet_idx').on(t.wallet, t.asset),
  ],
);

/** Vault deposits and withdrawals seen on Monad (history). */
export const vaultActivity = pgTable(
  'vault_activity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userAddress: text('user_address').notNull(),
    kind: text('kind').$type<'deposit' | 'withdrawal'>().notNull(),
    amountUsdc: text('amount_usdc').notNull(),
    txHash: text('tx_hash').notNull(),
    logIndex: integer('log_index').notNull(),
    at: tz('at').notNull(),
  },
  (t) => [
    uniqueIndex('vault_activity_uq').on(t.txHash, t.logIndex),
    index('vault_activity_user_idx').on(t.userAddress, t.at),
  ],
);
