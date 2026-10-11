import { cookies } from 'next/headers';
import Link from 'next/link';
import { PageHeader } from '@/components/app-shell';
import { NotificationList } from '@/components/notification-list';
import { serverApi } from '@/lib/api';

export const metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  const api = serverApi((await cookies()).toString());
  const page = await api.listNotifications({ query: { limit: 20, unreadOnly: 'false' } });
  return (
    <>
      <PageHeader title="Notifications">
        {page.unread} unread.{' '}
        <Link href="/notifications/preferences" className="underline">
          Preferences
        </Link>
      </PageHeader>
      <NotificationList initial={page.items} nextCursor={page.nextCursor} />
    </>
  );
}
