'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/** Header bell with unread count. Polls lightly; the list page fires `paras:notifications` after mark-read. */
export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const load = () =>
      api
        .listNotifications({ query: { limit: 1, unreadOnly: 'true' } })
        .then((r) => setUnread(r.unread))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 60_000);
    window.addEventListener('paras:notifications', load);
    return () => {
      clearInterval(t);
      window.removeEventListener('paras:notifications', load);
    };
  }, []);
  return (
    <Link
      href="/notifications"
      aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
      className="relative flex h-8 items-center rounded-full px-3 font-display text-[0.95rem] tracking-wide text-muted transition-colors hover:bg-surface hover:text-fg"
    >
      Alerts
      {unread > 0 && (
        <span className="ml-1.5 rounded-full bg-seal px-1.5 text-xs text-white">{unread}</span>
      )}
    </Link>
  );
}
