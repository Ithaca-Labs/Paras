import { ApiError } from '@paras/shared';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { PageHeader } from '@/components/app-shell';
import { EventCard } from '@/components/event-card';
import { SignInGate } from '@/components/sign-in-gate';
import { ErrorState } from '@/components/states';
import { serverApi } from '@/lib/api';

export const metadata = { title: 'Shared bet' };
export const dynamic = 'force-dynamic';

const MESSAGES: Record<number, string> = {
  400: 'This link is invalid or has been tampered with.',
  404: 'This link points to an Event that no longer exists.',
  410: 'This link has expired. Ask for a new one.',
  403: 'This link was made for a different account. Sign in with the right one.',
};

// Resolving only reads the prefill. Nothing is placed here: the Event page Bet panel does that,
// with the user signing the Intent.
export default async function MagicPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const cookie = (await cookies()).toString();
  let ml;
  try {
    ml = await serverApi(cookie).resolveMagicLink({ params: { token } });
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    return (
      <>
        <PageHeader title="Shared bet" />
        {e.status === 401 ? (
          <SignInGate message="Sign in to open this link." />
        ) : (
          <ErrorState message={MESSAGES[e.status] ?? 'Could not open this link.'} />
        )}
      </>
    );
  }
  const q = new URLSearchParams();
  if (ml.outcome) q.set('outcome', ml.outcome);
  if (ml.amount) q.set('amount', ml.amount);
  if (ml.maxPrice) q.set('maxPrice', ml.maxPrice);
  const qs = q.toString();
  return (
    <>
      <PageHeader title="Shared bet">
        From {ml.source}. Nothing is placed until you review and sign on the Event page.
      </PageHeader>
      <div className="flex max-w-xl flex-col gap-4">
        <EventCard event={ml.event} />
        <dl className="grid grid-cols-3 gap-2 rounded-card border border-border bg-surface p-4 text-sm">
          <div>
            <dt className="text-xs text-muted">Outcome</dt>
            <dd>{ml.outcome ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Amount</dt>
            <dd>{ml.amount ? `$${ml.amount}` : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Max price</dt>
            <dd>{ml.maxPrice ?? '—'}</dd>
          </div>
        </dl>
        <Link
          href={`/events/${ml.event.id}${qs ? `?${qs}` : ''}`}
          className="self-start rounded-sm bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:brightness-110"
        >
          Review on Event page
        </Link>
      </div>
    </>
  );
}
