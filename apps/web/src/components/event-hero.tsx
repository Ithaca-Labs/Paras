import type { EventView } from '@paras/shared';
import Image from 'next/image';
import { cents, usd, when } from '@/lib/format';
import { ornament } from './event-card';
import { OddsLine, venuePrices } from './odds-line';

/** Event page header: title, best price, the large odds line and key stats in one framed panel. */
export function EventHero({ event }: { event: EventView }) {
  const prices = venuePrices(event);
  const best = prices[0];
  const gap = prices.length > 1 ? Math.round((prices.at(-1)!.price - best!.price) * 100) : 0;
  const stats = [
    ['Volume', usd(event.volume)],
    ['Liquidity', usd(event.liquidity)],
    ['Venues', String(event.markets.length)],
    ['Closes', event.endDate ? when(event.endDate) : '—'],
  ];
  return (
    <header className="scroll-frame rise relative overflow-hidden rounded-[1.5rem] border border-gold/60 bg-surface shadow-[0_24px_60px_-40px_rgb(30_43_63/0.55)]">
      <div className="relative grid gap-8 p-6 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:p-9">
        <div className="relative">
          <Image
            src={`/brand/ornaments/${ornament(event.category)}.png`}
            alt=""
            width={400}
            height={270}
            priority
            className="ornament-soft pointer-events-none absolute -right-2 -bottom-16 hidden w-40 opacity-70 md:block"
          />
          <p className="relative mb-3 flex items-center gap-2 font-display text-xs tracking-[0.22em] text-muted uppercase">
            <span aria-hidden className="size-2 rounded-[2px] bg-seal" />
            {event.category ?? 'Event'}
            {event.status !== 'open' && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 tracking-normal normal-case">
                {event.status}
              </span>
            )}
          </p>
          <h1 className="relative text-3xl leading-[1.15] font-extrabold text-balance md:text-[2.6rem]">
            {event.title}
          </h1>
        </div>
        <div className="self-end relative rounded-xl border border-border/70 bg-bg/80 p-5">
          {best ? (
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs text-muted">
                  Best {best.label.toLowerCase()} price · {best.venue}
                </p>
                <p className="mt-1 font-display text-5xl leading-none font-extrabold tabular-nums">
                  {cents(String(best.price))}
                </p>
              </div>
              {gap > 0 && (
                <span className="stamp-badge rounded-full border border-seal/50 px-3 py-1 text-xs font-medium text-negative">
                  Venues {gap}¢ apart
                </span>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">No live price yet</p>
          )}
          <OddsLine event={event} size="lg" />
        </div>
      </div>
      <dl className="relative grid grid-cols-2 border-t border-border/70 bg-surface-2 md:grid-cols-4">
        {stats.map(([k, v], i) => (
          <div
            key={k}
            className={`px-6 py-4 md:px-9 ${i > 0 ? 'md:border-l' : ''} ${i % 2 ? 'border-l' : ''} border-border/70 ${i > 1 ? 'border-t md:border-t-0' : ''}`}
          >
            <dt className="text-[0.7rem] tracking-wide text-muted uppercase">{k}</dt>
            <dd className="mt-1 font-display text-lg font-bold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}
