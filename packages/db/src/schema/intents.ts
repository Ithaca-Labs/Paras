import type { IntentDetails, IntentStatus } from '@paras/domain';
import { bigserial, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity.js';

const tz = (name: string) => timestamp(name, { withTimezone: true });

/** Step data the Executor accumulates per Intent (tx hashes, CCTP message, order id, amounts in USDC base units). */
export interface IntentCtx {
  walletId?: string;
  dispatchTx?: string;
  message?: string;
  attestation?: string;
  mintedUsdc?: string;
  convertTx?: string;
  pusd?: string;
  orderKey?: string;
  orderId?: string;
  filledShares?: string;
  spentUsdc?: string;
  returnRelayerTx?: string;
  returnTx?: string;
  returnPusd?: string;
  returnMessage?: string;
  returnAttestation?: string;
  /** Terminal status to take once the return leg settles. */
  then?: 'partially_filled' | 'expired' | 'failed';
  reason?: string;
}

/**
 * A signed Intent as the Executor tracks it. Created by the preview API (`previewed`), advanced by the
 * Executor from Vault events and on-chain/off-chain steps. `(userAddress, intentId)` is the Vault key.
 */
export const intents = pgTable(
  'intents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** Lowercase 0x Monad address that signs and owns the Vault account. */
    userAddress: text('user_address').notNull(),
    /** 0x bytes32 Vault Intent id. */
    intentId: text('intent_id').notNull(),
    /** USDC base units (6 decimals). */
    amountUsdc: text('amount_usdc').notNull(),
    expiry: tz('expiry').notNull(),
    details: jsonb('details').$type<IntentDetails>().notNull(),
    detailsHash: text('details_hash').notNull(),
    status: text('status').$type<IntentStatus>().notNull().default('previewed'),
    ctx: jsonb('ctx').$type<IntentCtx>().notNull().default({}),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('intents_user_intent_uq').on(t.userAddress, t.intentId), index('intents_status_idx').on(t.status)],
);

/** Append-only status timeline per Intent. */
export const intentEvents = pgTable(
  'intent_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    intentRowId: uuid('intent_row_id')
      .notNull()
      .references(() => intents.id),
    status: text('status').$type<IntentStatus>().notNull(),
    note: jsonb('note').$type<Record<string, unknown>>().notNull().default({}),
    at: tz('at').notNull().defaultNow(),
  },
  (t) => [index('intent_events_intent_idx').on(t.intentRowId, t.id)],
);

/** Last block the Executor has processed for a chain watcher. */
export const chainCursors = pgTable('chain_cursors', {
  name: text('name').primaryKey(),
  block: text('block').notNull(),
});

/**
 * The User asks for a Deposit Wallet (owner = a wallet they control) and later supplies the EIP-712
 * `RegisterDepositWallet` signature. The Executor provisions and registers it (it alone writes `deposit_wallets`).
 */
export const walletRequests = pgTable('wallet_requests', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id),
  /** Lowercase 0x: the User's EOA, owner of the Polygon wallet and the Vault account. */
  owner: text('owner').notNull(),
  signature: text('signature'),
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
});
