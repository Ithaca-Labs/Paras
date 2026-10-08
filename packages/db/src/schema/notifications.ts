import type { NotificationFrequency, NotificationKind } from '@paras/domain';
import {
  bigserial,
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { events } from './markets.js';

// Owner key as in feed.ts: `u:<userId>` or `a:<anonTokenHash>`; no FK (sign-in/mergeUsers rewrite it).

/** Every notification ever raised; doubles as the dedupe log. `inApp=false` rows are email-only. */
export const notifications = pgTable(
  'notifications',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ownerKey: text('owner_key').notNull(),
    kind: text('kind').$type<NotificationKind>().notNull(),
    /** Same (owner, dedupeKey) is never raised twice. */
    dedupeKey: text('dedupe_key').notNull(),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    inApp: boolean('in_app').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
    emailedAt: timestamp('emailed_at', { withTimezone: true }),
  },
  (t) => [
    unique('notifications_dedupe_uq').on(t.ownerKey, t.dedupeKey),
    index('notifications_owner_idx').on(t.ownerKey, t.id),
  ],
);

export const notificationPrefs = pgTable('notification_prefs', {
  ownerKey: text('owner_key').primaryKey(),
  email: boolean('email').notNull().default(true),
  inApp: boolean('in_app').notNull().default(true),
  frequency: text('frequency').$type<NotificationFrequency>().notNull().default('instant'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
