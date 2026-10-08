import { schema } from '@paras/db';
import { DEFAULT_NOTIFICATION_PREFS } from '@paras/domain';
import { apiRoutes } from '@paras/shared';
import { and, count, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { HttpError } from '../errors.js';
import { ownerKeyOf } from '../feed/store.js';
import { implement } from '../implement.js';
import type { RoutePlugin } from './index.js';

const { notifications, notificationPrefs } = schema;

export const notificationRoutes: RoutePlugin = (app, { db }) => {
  const opt = { auth: 'optional' } as const;

  implement(
    app,
    apiRoutes.listNotifications,
    async ({ query }, { request, auth }) => {
      const key = ownerKeyOf(request, auth);
      if (!key) return { items: [], unread: 0, nextCursor: null };
      const mine = and(eq(notifications.ownerKey, key), eq(notifications.inApp, true));
      const cursor = query.cursor === undefined ? undefined : Number(query.cursor);
      if (cursor !== undefined && !Number.isInteger(cursor)) {
        throw new HttpError(400, 'validation_error', 'invalid cursor');
      }
      const rows = await db
        .select()
        .from(notifications)
        .where(
          and(
            mine,
            cursor === undefined ? undefined : lt(notifications.id, cursor),
            query.unreadOnly === 'true' ? isNull(notifications.readAt) : undefined,
          ),
        )
        .orderBy(desc(notifications.id))
        .limit(query.limit + 1);
      const [unread] = await db
        .select({ n: count() })
        .from(notifications)
        .where(and(mine, isNull(notifications.readAt)));
      const page = rows.slice(0, query.limit);
      return {
        items: page.map((r) => ({
          id: r.id,
          kind: r.kind,
          title: r.title,
          body: r.body,
          eventId: r.eventId,
          createdAt: r.createdAt.toISOString(),
          readAt: r.readAt?.toISOString() ?? null,
        })),
        unread: unread?.n ?? 0,
        nextCursor: rows.length > query.limit ? String(page.at(-1)!.id) : null,
      };
    },
    opt,
  );

  implement(
    app,
    apiRoutes.markNotificationsRead,
    async ({ body }, { request, auth }) => {
      const key = ownerKeyOf(request, auth);
      if (!key) return { updated: 0 };
      const done = await db
        .update(notifications)
        .set({ readAt: sql`now()` })
        .where(
          and(
            eq(notifications.ownerKey, key),
            isNull(notifications.readAt),
            body.ids ? inArray(notifications.id, body.ids) : undefined,
          ),
        )
        .returning({ id: notifications.id });
      return { updated: done.length };
    },
    opt,
  );

  implement(
    app,
    apiRoutes.getNotificationPrefs,
    async (_req, { request, auth }) => {
      const key = ownerKeyOf(request, auth);
      const [row] = key
        ? await db.select().from(notificationPrefs).where(eq(notificationPrefs.ownerKey, key))
        : [];
      const { email, inApp, frequency } = row ?? DEFAULT_NOTIFICATION_PREFS;
      return { email, inApp, frequency };
    },
    opt,
  );

  implement(
    app,
    apiRoutes.updateNotificationPrefs,
    async ({ body }, { request, auth }) => {
      const key = ownerKeyOf(request, auth);
      if (!key) throw new HttpError(401, 'unauthorized', 'Sign in (or follow an Event) first');
      await db
        .insert(notificationPrefs)
        .values({ ownerKey: key, ...body })
        .onConflictDoUpdate({
          target: notificationPrefs.ownerKey,
          set: { ...body, updatedAt: sql`now()` },
        });
      return body;
    },
    opt,
  );
};
