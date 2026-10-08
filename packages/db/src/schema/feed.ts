import type { FollowKind, SignalKind } from '@paras/domain';
import { bigserial, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { events } from './markets.js';

// Owner of Feed state: `u:<userId>` for a User, `a:<anonTokenHash>` for an anonymous visitor.
// Sign-in and mergeUsers rewrite the key, so there is no foreign key.

/** Implicit Feed signals; weight decays with age at read time. */
export const feedSignals = pgTable(
  'feed_signals',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ownerKey: text('owner_key').notNull(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<SignalKind>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('feed_signals_owner_idx').on(t.ownerKey, t.createdAt)],
);

/** What the owner follows: an Event, or a taxonomy topic/entity id. */
export const follows = pgTable(
  'follows',
  {
    ownerKey: text('owner_key').notNull(),
    kind: text('kind').$type<FollowKind>().notNull(),
    targetId: text('target_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ownerKey, t.kind, t.targetId] })],
);
