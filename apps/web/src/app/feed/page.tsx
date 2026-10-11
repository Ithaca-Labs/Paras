import { cookies } from 'next/headers';
import { PageHeader } from '@/components/app-shell';
import { EventCard } from '@/components/event-card';
import { EmptyState } from '@/components/states';
import { serverApi } from '@/lib/api';

export const metadata = { title: 'Feed' };

// STUB page (#27 builds the real Feed UI). Shows the wiring: server component -> typed client.
export default async function FeedPage() {
  const cookie = (await cookies()).toString();
  const feed = await serverApi(cookie).getFeed({ query: { limit: 20 } });
  return (
    <>
      <PageHeader title="Feed">
        {feed.personalized ? 'Picked for you.' : 'Popular right now.'}
      </PageHeader>
      {feed.items.length === 0 ? (
        <EmptyState>No Events yet.</EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {feed.items.map((i) => (
            <EventCard key={i.event.id} event={i.event} reason={i.reason} />
          ))}
        </div>
      )}
    </>
  );
}
