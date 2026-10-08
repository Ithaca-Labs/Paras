import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity.js';

const tz = (name: string) => timestamp(name, { withTimezone: true });

/** A user's Polymarket Deposit Wallet on Polygon (owner = the user's own EOA). Written only by apps/executor. */
export const depositWallets = pgTable(
  'deposit_wallets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** Lowercase 0x. The user's EOA; the only party who can change owner / authorize session keys. */
    ownerAddress: text('owner_address').notNull(),
    /** Lowercase 0x; counterfactual address from the factory (`predictWalletAddress(salt)`). */
    walletAddress: text('wallet_address').notNull().unique(),
    /** 0x bytes32 factory id/salt. */
    salt: text('salt').notNull(),
    chainId: text('chain_id').notNull(),
    /** pending (address predicted) -> deployed (relayer confirmed) -> registered (Vault knows it). */
    status: text('status', { enum: ['pending', 'deployed', 'registered'] })
      .notNull()
      .default('pending'),
    deployTxId: text('deploy_tx_id'),
    createdAt: tz('created_at').notNull().defaultNow(),
    registeredAt: tz('registered_at'),
  },
  (t) => [uniqueIndex('deposit_wallets_user_chain_idx').on(t.userId, t.chainId)],
);

/** Executor session keys. The private key is stored encrypted (AES-GCM, env master key; KMS before mainnet). */
export const executorSessionKeys = pgTable(
  'executor_session_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => depositWallets.id),
    /** Lowercase 0x session signer address. */
    address: text('address').notNull().unique(),
    ciphertext: text('ciphertext').notNull(),
    /** pending (awaiting owner signature) -> active -> revoked. */
    status: text('status', { enum: ['pending', 'active', 'revoked'] })
      .notNull()
      .default('pending'),
    validUntil: tz('valid_until').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
    activatedAt: tz('activated_at'),
    revokedAt: tz('revoked_at'),
  },
  (t) => [index('executor_session_keys_wallet_idx').on(t.walletId, t.status)],
);

/** Funding committed per Intent on Polygon (USDC base units, 6 decimals) for per-Intent caps. */
export const intentFunding = pgTable('intent_funding', {
  intentId: text('intent_id').primaryKey(),
  walletId: uuid('wallet_id')
    .notNull()
    .references(() => depositWallets.id),
  capUsdc: text('cap_usdc').notNull(),
  fundedUsdc: text('funded_usdc').notNull().default('0'),
  updatedAt: tz('updated_at').notNull().defaultNow(),
});
