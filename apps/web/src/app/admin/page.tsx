import { ApiError } from '@paras/shared';
import { cookies } from 'next/headers';
import { AdminConsole } from '@/components/admin-console';
import { PageHeader } from '@/components/app-shell';
import { SignInGate } from '@/components/sign-in-gate';
import { EmptyState } from '@/components/states';
import { serverApi } from '@/lib/api';

export const metadata = { title: 'Admin' };

export default async function AdminPage() {
  const client = serverApi((await cookies()).toString());
  let data;
  try {
    const [health, pauses, reviews] = await Promise.all([
      client.getVenueHealth(),
      client.getPauses(),
      client.listMatchReviews({ query: { status: 'pending', limit: 50 } }),
    ]);
    data = { health, pauses, reviews: reviews.items };
  } catch (e) {
    // The API owns the admin check; the page only reflects its answer.
    if (e instanceof ApiError && e.status === 401)
      return (
        <>
          <PageHeader title="Admin" />
          <SignInGate message="Sign in with an operator account." />
        </>
      );
    if (e instanceof ApiError && e.status === 403)
      return (
        <>
          <PageHeader title="Admin" />
          <EmptyState>Admin only. This account is not an operator.</EmptyState>
        </>
      );
    throw e;
  }
  return (
    <>
      <PageHeader title="Operator console">
        Venue health, Executor pauses and the match review queue. Every action goes through the
        admin API.
      </PageHeader>
      <AdminConsole initial={data} />
    </>
  );
}
