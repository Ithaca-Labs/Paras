'use client';

import type { Notification } from '@paras/shared';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { EmptyState } from './states';

const btn = 'rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-fg';

export function NotificationList({
  initial,
  nextCursor: initialCursor,
}: {
  initial: Notification[];
  nextCursor: string | null;
}) {
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(initialCursor);
  const unread = items.filter((n) => !n.readAt).length;

  const markRead = async (ids?: number[]) => {
    await api.markNotificationsRead({ body: { ids } });
    const now = new Date().toISOString();
    setItems((xs) =>
      xs.map((n) => (!n.readAt && (!ids || ids.includes(n.id)) ? { ...n, readAt: now } : n)),
    );
    window.dispatchEvent(new Event('paras:notifications'));
  };
  const more = async () => {
    if (!cursor) return;
    const p = await api.listNotifications({ query: { limit: 20, cursor, unreadOnly: 'false' } });
    setItems((xs) => [...xs, ...p.items]);
    setCursor(p.nextCursor);
  };

  if (items.length === 0) return <EmptyState>No notifications yet.</EmptyState>;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <button className={btn} disabled={unread === 0} onClick={() => markRead()}>
          Mark all read
        </button>
      </div>
      <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface">
        {items.map((n) => (
          <li key={n.id} className="flex items-start gap-3 p-4">
            <span
              aria-label={n.readAt ? 'Read' : 'Unread'}
              className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? 'bg-border' : 'bg-accent'}`}
            />
            <div className="flex-1">
              <p className="text-sm font-medium">
                {n.eventId ? (
                  <Link href={`/events/${n.eventId}`} className="hover:underline">
                    {n.title}
                  </Link>
                ) : (
                  n.title
                )}
              </p>
              <p className="text-sm text-muted">{n.body}</p>
              <p className="mt-1 text-xs text-muted">
                {n.kind.replace('_', ' ')} · {new Date(n.createdAt).toLocaleString()}
              </p>
            </div>
            {!n.readAt && (
              <button className="text-xs text-muted underline" onClick={() => markRead([n.id])}>
                Mark read
              </button>
            )}
          </li>
        ))}
      </ul>
      {cursor && (
        <button className={`${btn} self-start`} onClick={more}>
          Load more
        </button>
      )}
    </div>
  );
}
