import { index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity.js';
import { events } from './markets.js';

const tz = (name: string) => timestamp(name, { withTimezone: true });

/** Audit of every issued Magic Link token (the token itself is never stored). */
export const magicLinks = pgTable(
  'magic_links',
  {
    /** The token's `jti`. */
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    outcome: text('outcome'),
    amount: numeric('amount'),
    maxPrice: numeric('max_price'),
    source: text('source').$type<'claude' | 'codex' | 'web'>().notNull(),
    /** Optional binding: only this User may resolve. */
    userId: uuid('user_id').references(() => users.id),
    kid: text('kid').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
    expiresAt: tz('expires_at').notNull(),
    resolveCount: integer('resolve_count').notNull().default(0),
    lastResolvedAt: tz('last_resolved_at'),
  },
  (t) => [index('magic_links_event_idx').on(t.eventId), index('magic_links_user_idx').on(t.userId)],
);
