import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity.js';

const tz = (name: string) => timestamp(name, { withTimezone: true });

/**
 * A User's Privy embedded wallet (#92). Keyed by wallet id; the address is also a `wallet_links` row,
 * so it is the Vault account. Repointed by `mergeUsers`.
 */
export const privyWallets = pgTable('privy_wallets', {
  walletId: text('wallet_id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  privyUserId: text('privy_user_id').notNull(),
  /** Lowercase 0x. */
  address: text('address').notNull().unique(),
  createdAt: tz('created_at').notNull().defaultNow(),
});

/**
 * Paras's session signer on a User's embedded wallet, under a Privy policy. `pending` until the
 * wallet's `additional_signers` is confirmed at Privy, `revoked` ends it (the helper refuses).
 * USDC amounts are base units (6 decimals).
 */
export const delegations = pgTable('delegations', {
  walletId: text('wallet_id')
    .primaryKey()
    .references(() => privyWallets.walletId),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  status: text('status').$type<'pending' | 'active' | 'revoked'>().notNull().default('pending'),
  policyId: text('policy_id').notNull(),
  signerId: text('signer_id').notNull(),
  /** Max for one Intent (also in the Privy policy). */
  maxIntentUsdc: text('max_intent_usdc').notNull(),
  /** Cumulative cap over the delegation's life; enforced here (Privy policies are stateless). */
  capUsdc: text('cap_usdc').notNull(),
  /** Committed so far. Not refunded when an Intent later fails (conservative). */
  spentUsdc: text('spent_usdc').notNull().default('0'),
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
});
