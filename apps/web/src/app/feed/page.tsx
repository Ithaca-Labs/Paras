import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/app-shell';
import { FeedList } from '@/components/feed-list';
import { EmptyState } from '@/components/states';
import { serverApi } from '@/lib/api';

export const metadata = { title: 'Feed' };

export default async function FeedPage() {
  const api = serverApi((await cookies()).toString());
  const profile = await api.getProfile();
  if (profile.status === 'none') redirect('/onboarding');
  const [feed, follows] = await Promise.all([
    api.getFeed({ query: { limit: 20 } }),
    api.listFollows(),
  ]);
  const followed = follows.items.filter((f) => f.kind === 'event').map((f) => f.targetId);
  return (
    <>
      <PageHeader title="Feed">
        {feed.personalized ? 'Picked for you.' : 'Popular right now.'}{' '}
        <Link href="/onboarding" className="underline">
          Edit interests
        </Link>
      </PageHeader>
      {feed.items.length + feed.beginners.length === 0 ? (
        <EmptyState>No Events yet.</EmptyState>
      ) : (
        <FeedList feed={feed} followedEventIds={followed} />
      )}
    </>
  );
}
