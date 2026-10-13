import type { EventView } from '@paras/shared';
import Link from 'next/link';
import { cents, usd } from '@/lib/format';
import { OddsLine, venuePrices } from './odds-line';

/**
 * One Event with its cross-Venue Quotes. Pure presentational: pass an `EventView` from the API.
 * Leads with the cheapest first-Outcome price (usually YES), then each Venue's price.
 */
export function EventCard({ event, reason }: { event: EventView; reason?: string }) {
  const prices = venuePrices(event);
  const best = prices[0];
  const gap = prices.length > 1 ? Math.round((prices.at(-1)!.price - best!.price) * 100) : 0;
  return (
    <article className="slip group flex flex-col rounded-card border border-border bg-surface p-5">
      <p className="mb-2 flex items-center gap-2 text-[0.7rem] font-medium tracking-wide text-muted uppercase">
        {event.category ?? 'Event'}
        {reason && (
          <>
            <span aria-hidden>·</span>
            <span className="truncate font-normal tracking-normal normal-case">{reason}</span>
          </>
        )}
      </p>
      <h3 className="font-display text-lg leading-snug font-bold text-balance">
        <Link
          href={`/events/${event.id}`}
          className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
        >
          {event.title}
        </Link>
      </h3>

      <div className="mt-auto pt-5">
        {best ? (
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <p className="flex items-baseline gap-2">
              <span className="font-display text-3xl leading-none font-extrabold tabular-nums">
                {cents(String(best.price))}
              </span>
              <span className="text-xs text-muted">{best.label}, best price</span>
            </p>
            {gap > 0 && (
              <span className="rounded-sm bg-seal/12 px-1.5 py-0.5 font-mono text-[0.7rem] text-negative">
                {gap}¢ apart
              </span>
            )}
          </div>
        ) : (
          <p className="mb-3 text-sm text-muted">No live price yet</p>
        )}
        <OddsLine event={event} />
        {prices.length > 0 && (
          <ul className="mt-3 space-y-1 text-[0.8rem]">
            {prices.slice(0, 3).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3">
                <span className={`truncate ${p.stale ? 'text-muted' : ''}`}>
                  {p.venue}
                  {p.stale && <span className="ml-1.5 text-[0.65rem] text-warning">stale</span>}
                </span>
                <span className="font-mono tabular-nums">{cents(String(p.price))}</span>
              </li>
            ))}
            {prices.length > 3 && (
              <li className="text-[0.7rem] text-muted">+{prices.length - 3} more Venues</li>
            )}
          </ul>
        )}
        <footer className="mt-4 flex items-center justify-between border-t border-border pt-3 text-[0.7rem] text-muted">
          <span>{usd(event.volume)} traded</span>
          <span className="flex items-center gap-1 transition-colors group-hover:text-fg">
            Compare
            <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
              →
            </span>
          </span>
        </footer>
      </div>
    </article>
  );
}
