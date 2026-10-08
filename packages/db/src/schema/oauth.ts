import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity.js';

const tz = (name: string) => timestamp(name, { withTimezone: true });

/** Dynamically registered (RFC 7591) public clients: PKCE, no secret. */
export const oauthClients = pgTable('oauth_clients', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  redirectUris: text('redirect_uris').array().notNull(),
  createdAt: tz('created_at').notNull().defaultNow(),
});

/** A User's consent to a client = one "connected app". Deleting it revokes every token. */
export const oauthGrants = pgTable(
  'oauth_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    scopes: text('scopes').array().notNull(),
    /** RFC 8707 resource the tokens are bound to; null = unbound (resource servers reject). */
    audience: text('audience'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [index('oauth_grants_user_idx').on(t.userId)],
);

/** Short-lived, single-use authorization codes (sha256 of the code). */
export const oauthCodes = pgTable('oauth_codes', {
  codeHash: text('code_hash').primaryKey(),
  clientId: text('client_id')
    .notNull()
    .references(() => oauthClients.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  scopes: text('scopes').array().notNull(),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  resource: text('resource'),
  expiresAt: tz('expires_at').notNull(),
});

/** Opaque access/refresh tokens (sha256). Refresh tokens rotate on use. */
export const oauthTokens = pgTable(
  'oauth_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    kind: text('kind').$type<'access' | 'refresh'>().notNull(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => oauthGrants.id, { onDelete: 'cascade' }),
    expiresAt: tz('expires_at').notNull(),
  },
  (t) => [index('oauth_tokens_grant_idx').on(t.grantId)],
);
