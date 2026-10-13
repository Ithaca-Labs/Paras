import { ApiError } from '@paras/shared';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/app-shell';
import { BetPanel } from '@/components/bet-panel';
import { EventLive } from '@/components/event-live';
import { OddsLine } from '@/components/odds-line';
import { PriceChart } from '@/components/price-chart';
import { RulesCompare } from '@/components/rules-compare';
import { SmartMoneyPanel } from '@/components/smart-money-panel';
import { serverApi } from '@/lib/api';
import { usd, when } from '@/lib/format';

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

  return (
    <>
      <PageHeader title={event.title}>
        {[event.category, event.endDate && `Closes ${when(event.endDate)}`]
          .filter(Boolean)
          .join(' · ')}
      </PageHeader>
      <div className="flex flex-col gap-8">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
          <span>Vol {usd(event.volume)}</span>
          <span>Liq {usd(event.liquidity)}</span>
          <span>{event.markets.length} Venues</span>
          {event.tags.map((t) => (
            <Link
              key={t.id}
              href={`/explore?${t.kind}=${encodeURIComponent(t.id)}`}
              className="hover:text-fg hover:underline"
            >
              #{t.label}
            </Link>
          ))}
        </div>
        <div className="max-w-3xl">
          <OddsLine event={event} size="lg" />
        </div>
        {event.description && (
          <p className="max-w-3xl text-sm leading-relaxed text-muted">{event.description}</p>
        )}
        <EventLive event={event} initial={comparison} />
        <BetPanel eventId={event.id} />
        <PriceChart eventId={event.id} initial={history} />
        <SmartMoneyPanel smartMoney={event.smartMoney} explain={explain} />
        <RulesCompare markets={event.markets} />
      </div>
    </>
  );
}
