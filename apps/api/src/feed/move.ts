import { schema, type Database } from '@paras/db';
import { eq, sql } from 'drizzle-orm';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Hand all Feed state of `from` to `to` (sign-in claims an anonymous visitor; mergeUsers). */
export async function moveFeedState(tx: Tx, from: string, to: string) {
  const { follows, feedSignals } = schema;
  await tx.execute(sql`
    insert into follows (owner_key, kind, target_id, created_at)
    select ${to}, kind, target_id, created_at from follows where owner_key = ${from}
    on conflict do nothing`);
  await tx.delete(follows).where(eq(follows.ownerKey, from));
  // Notifications dedupe on (owner, key): `to`'s copy wins on conflict. Prefs: `to`'s win too.
  await tx.execute(sql`
    insert into notifications (owner_key, kind, dedupe_key, event_id, title, body, in_app, created_at, read_at, emailed_at)
    select ${to}, kind, dedupe_key, event_id, title, body, in_app, created_at, read_at, emailed_at
    from notifications where owner_key = ${from}
    on conflict do nothing`);
  await tx.delete(schema.notifications).where(eq(schema.notifications.ownerKey, from));
  await tx.execute(sql`
    insert into notification_prefs (owner_key, email, in_app, frequency, updated_at)
    select ${to}, email, in_app, frequency, updated_at from notification_prefs where owner_key = ${from}
    on conflict do nothing`);
  await tx.delete(schema.notificationPrefs).where(eq(schema.notificationPrefs.ownerKey, from));
  await tx.update(feedSignals).set({ ownerKey: to }).where(eq(feedSignals.ownerKey, from));
}
