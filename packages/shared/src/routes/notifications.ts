import { defineRoute } from '../route.js';
import { z } from '../zod.js';

export const NotificationKind = z.enum(['price_move', 'closing_soon', 'digest', 'intent_update']);
export const NotificationFrequency = z.enum(['instant', 'daily', 'weekly', 'off']);

export const Notification = z.object({
  id: z.number().int(),
  kind: NotificationKind,
  title: z.string(),
  body: z.string(),
  eventId: z.string().uuid().nullable(),
  createdAt: z.iso.datetime(),
  /** Null while unread. */
  readAt: z.iso.datetime().nullable(),
});
export type Notification = z.infer<typeof Notification>;

export const NotificationPrefs = z.object({
  email: z.boolean(),
  inApp: z.boolean(),
  /** Minimum gap between alerts; `off` mutes alerts and the weekly digest. Intent updates always arrive. */
  frequency: NotificationFrequency,
});
export type NotificationPrefs = z.infer<typeof NotificationPrefs>;

const tags = ['notifications'];

export const listNotifications = defineRoute({
  method: 'get',
  path: '/v1/notifications',
  operationId: 'listNotifications',
  summary: 'In-app notifications for the caller (User or anonymous visitor), newest first',
  tags,
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      /** `nextCursor` of the previous page. */
      cursor: z.string().optional(),
      unreadOnly: z.enum(['true', 'false']).default('false'),
    }),
  },
  response: z.object({
    items: z.array(Notification),
    unread: z.number().int(),
    nextCursor: z.string().nullable(),
  }),
});

export const markNotificationsRead = defineRoute({
  method: 'post',
  path: '/v1/notifications/read',
  operationId: 'markNotificationsRead',
  summary: "Mark the given notifications read, or all of the caller's when `ids` is omitted",
  tags,
  request: { body: z.object({ ids: z.array(z.number().int()).max(200).optional() }) },
  response: z.object({ updated: z.number().int() }),
});

export const getNotificationPrefs = defineRoute({
  method: 'get',
  path: '/v1/notifications/preferences',
  operationId: 'getNotificationPrefs',
  summary: 'Notification channels and frequency (defaults: email + in-app, instant)',
  tags,
  request: {},
  response: NotificationPrefs,
});

export const updateNotificationPrefs = defineRoute({
  method: 'put',
  path: '/v1/notifications/preferences',
  operationId: 'updateNotificationPrefs',
  summary: 'Set notification channels and frequency. Anonymous visitors only ever get in-app',
  tags,
  request: { body: NotificationPrefs },
  response: NotificationPrefs,
});
