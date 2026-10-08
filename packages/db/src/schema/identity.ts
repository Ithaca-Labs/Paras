import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const tz = (name: string) => timestamp(name, { withTimezone: true });

/** A Paras account. Absorbed Users are kept as tombstones (`mergedIntoId`) so later FKs never dangle. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: tz('created_at').notNull().defaultNow(),
  mergedIntoId: uuid('merged_into_id').references((): AnyPgColumn => users.id),
});

export const walletLinks = pgTable(
  'wallet_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** Lowercase 0x address. */
    address: text('address').notNull().unique(),
    chainId: integer('chain_id').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [index('wallet_links_user_idx').on(t.userId)],
);

export const emailIdentities = pgTable(
  'email_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** Normalized (lowercase). Only verified emails are ever stored. */
    email: text('email').notNull().unique(),
    verifiedAt: tz('verified_at').notNull().defaultNow(),
  },
  (t) => [index('email_identities_user_idx').on(t.userId)],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** sha256 of the opaque token; the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: tz('created_at').notNull().defaultNow(),
    expiresAt: tz('expires_at').notNull(),
  },
  (t) => [index('auth_sessions_user_idx').on(t.userId)],
);

/** Single-use SIWE nonces. `returnTo` rides along to the verify step. */
export const siweNonces = pgTable('siwe_nonces', {
  nonce: text('nonce').primaryKey(),
  returnTo: text('return_to'),
  expiresAt: tz('expires_at').notNull(),
});

export const emailCodes = pgTable(
  'email_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    /** HMAC(secret, email:code); the code itself is never stored. */
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    returnTo: text('return_to'),
    requestIp: text('request_ip'),
    createdAt: tz('created_at').notNull().defaultNow(),
    expiresAt: tz('expires_at').notNull(),
    consumedAt: tz('consumed_at'),
  },
  (t) => [index('email_codes_email_idx').on(t.email, t.createdAt)],
);
