import type { EventView } from '@paras/shared';
import Link from 'next/link';
import { cents, usd } from '@/lib/format';

/**
 * One Event with its cross-Venue Quotes. Pure presentational: pass an `EventView` from the API.
 * Shows each Venue's first Outcome (usually YES) so prices can be compared at a glance.
 */
export function EventCard({ event, reason }: { event: EventView; reason?: string }) {
  return (
    <article className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
      <header className="flex flex-col gap-1">
        {event.category && (
          <span className="text-xs uppercase tracking-wide text-muted">{event.category}</span>
        )}
        <h3 className="text-base font-medium leading-snug">
          <Link href={`/events/${event.id}`} className="hover:underline">
            {event.title}
          </Link>
        </h3>
        {reason && <p className="text-xs text-muted">{reason}</p>}
      </header>

      <ul className="flex flex-col divide-y divide-border text-sm">
        {event.markets.map((m) => {
          const o = m.outcomes[0];
          return (
            <li key={m.id} className="flex items-center justify-between py-1.5">
              <span>
                {m.venue.name}
                {m.stale && <span className="ml-2 text-xs text-warning">stale</span>}
                {m.lowConfidence && <span className="ml-2 text-xs text-warning">low match</span>}
              </span>
              <span className="font-mono tabular-nums">
                {o ? `${o.label} ${cents(o.quote?.last ?? o.quote?.ask)}` : '—'}
              </span>
            </li>
          );
        })}
      </ul>

      <footer className="flex gap-4 text-xs text-muted">
        <span>Vol {usd(event.volume)}</span>
        <span>Liq {usd(event.liquidity)}</span>
        <span>{event.markets.length} Venues</span>
      </footer>
    </article>
  );
}
