import { PageHeader } from '@/components/app-shell';
import { EventCard } from '@/components/event-card';
import { EmptyState } from '@/components/states';
import { serverApi } from '@/lib/api';

export const metadata = { title: 'Explore' };

// STUB page (#28 builds search + filters). Dynamic: always reads live Quotes.
export const dynamic = 'force-dynamic';

export default async function ExplorePage() {
  const { items } = await serverApi().listEvents({ query: { limit: 20, status: 'open' } });
  return (
    <>
      <PageHeader title="Explore">Compare prices across Venues.</PageHeader>
      {items.length === 0 ? (
        <EmptyState>No Events yet.</EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
        </div>
      )}
    </>
  );
}
