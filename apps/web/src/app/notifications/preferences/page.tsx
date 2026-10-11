import { cookies } from 'next/headers';
import { PageHeader } from '@/components/app-shell';
import { NotificationPrefsForm } from '@/components/notification-prefs-form';
import { serverApi } from '@/lib/api';

export const metadata = { title: 'Notification preferences' };

export default async function NotificationPrefsPage() {
  const prefs = await serverApi((await cookies()).toString()).getNotificationPrefs();
  return (
    <>
      <PageHeader title="Notification preferences">Channels and how often we alert you.</PageHeader>
      <NotificationPrefsForm initial={prefs} />
    </>
  );
}
