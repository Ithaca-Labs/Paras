import { ApiError } from '@paras/shared';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BetPanel } from '@/components/bet-panel';
import { EventHero } from '@/components/event-hero';
import { EventLive } from '@/components/event-live';
import { PriceChart } from '@/components/price-chart';
import { RulesCompare } from '@/components/rules-compare';
import { SmartMoneyPanel } from '@/components/smart-money-panel';
import { serverApi } from '@/lib/api';
import { plainText } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Per-caller availability depends on the session/geo, so forward the cookie.
  const api = serverApi((await cookies()).toString());
  const [event, comparison, history, explain] = await Promise.all([
    api.getEvent({ params: { id } }),
    api.compareEvent({ params: { id }, query: {} }),
    api.getEventHistory({ params: { id }, query: {} }),
    api.explainEvent({ params: { id } }).catch(() => null),
  ]).catch((e) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  });
  const about = plainText(event.description);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-2 text-xs text-muted">
        <Link href="/explore" className="hover:text-fg">
          Explore
        </Link>
        {event.category && (
          <>
            <span aria-hidden>/</span>
            <Link
              href={`/explore?category=${encodeURIComponent(event.category)}`}
              className="capitalize hover:text-fg"
            >
              {event.category}
            </Link>
          </>
        )}
      </nav>
      <EventHero event={event} />

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-10">
          <EventLive event={event} initial={comparison} />
          <PriceChart eventId={event.id} initial={history} />
          <SmartMoneyPanel smartMoney={event.smartMoney} explain={explain} />
          <RulesCompare markets={event.markets} />
        </div>
        <aside className="flex flex-col gap-6 lg:sticky lg:top-20">
          <BetPanel eventId={event.id} />
          {(about || event.tags.length > 0) && (
            <section
              aria-labelledby="about-h"
              className="rounded-card border border-border bg-surface p-5"
            >
              <h2 id="about-h" className="mb-2 text-base">
                About this Event
              </h2>
              {about && (
                <details className="group text-sm leading-relaxed text-muted">
                  <summary className="cursor-pointer list-none">
                    <span className="line-clamp-4 whitespace-pre-line group-open:line-clamp-none">
                      {about}
                    </span>
                    <span className="mt-2 inline-block text-xs font-medium text-accent group-open:hidden">
                      Read more
                    </span>
                  </summary>
                </details>
              )}
              {event.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {event.tags.map((t) => (
                    <Link
                      key={t.id}
                      href={`/explore?${t.kind}=${encodeURIComponent(t.id)}`}
                      className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted hover:border-accent hover:text-fg"
                    >
                      {t.label}
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
