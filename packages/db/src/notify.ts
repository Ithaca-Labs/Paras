import {
  ALERT_KINDS,
  DEFAULT_NOTIFICATION_PREFS,
  deliveryChannels,
  type NotificationKind,
} from '@paras/domain';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Database } from './client.js';
import { emailIdentities, notificationPrefs, notifications } from './schema/index.js';

/** Structural subset of @paras/shared's Mailer. */
export interface NotifyMailer {
  send(email: { to: string; subject: string; text: string }): Promise<void>;
}

export interface NotifyInput {
  /** `u:<userId>` or `a:<anonTokenHash>` (anonymous owners get in-app only: no email on file). */
  ownerKey: string;
  kind: NotificationKind;
  /** Same (ownerKey, dedupeKey) is delivered at most once. */
  dedupeKey: string;
  title: string;
  body: string;
  eventId?: string;
}

/**
 * The single entry point for raising a notification (alerts, digest, Intent fill/fail).
 * Applies the owner's channel + frequency preferences, dedupes, stores the in-app row, then emails.
 * Returns false when skipped (muted, throttled or already sent).
 */
export async function notify(
  db: Database,
  mailer: NotifyMailer | undefined,
  input: NotifyInput,
  now = new Date(),
): Promise<boolean> {
  const { ownerKey } = input;
  const [row] = await db
    .select()
    .from(notificationPrefs)
    .where(eq(notificationPrefs.ownerKey, ownerKey));
  const prefs = row ?? DEFAULT_NOTIFICATION_PREFS;
  const [last] = await db
    .select({ at: notifications.createdAt })
    .from(notifications)
    .where(and(eq(notifications.ownerKey, ownerKey), inArray(notifications.kind, [...ALERT_KINDS])))
    .orderBy(desc(notifications.id))
    .limit(1);
  const channels = deliveryChannels(input.kind, prefs, last?.at ?? null, now);
  if (!channels) return false;

  const [created] = await db
    .insert(notifications)
    .values({
      ownerKey,
      kind: input.kind,
      dedupeKey: input.dedupeKey,
      eventId: input.eventId ?? null,
      title: input.title,
      body: input.body,
      inApp: channels.inApp,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  if (!created) return false;

  if (channels.email && mailer && ownerKey.startsWith('u:')) {
    const [identity] = await db
      .select({ email: emailIdentities.email })
      .from(emailIdentities)
      .where(eq(emailIdentities.userId, ownerKey.slice(2)))
      .limit(1);
    if (identity) {
      await mailer.send({ to: identity.email, subject: input.title, text: input.body });
      await db
        .update(notifications)
        .set({ emailedAt: now })
        .where(eq(notifications.id, created.id));
    }
  }
  return true;
}
